import { readFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { constants as zlibConstants, createBrotliCompress, createDeflate, createGzip } from "node:zlib";

/**
 * Local fixture site for URL-mode tests (127.0.0.1, random port). It only starts with the test-only
 * escape hatch URL_FETCH_ALLOW_PRIVATE=1 and never under NODE_ENV=production. No test touches the internet.
 */
export interface FixtureSite {
  origin: string;
  /** request log: "METHOD /path" */
  requests: string[];
  close(): Promise<void>;
}

const page = (name: string) => readFileSync(path.join(__dirname, "pages", `${name}.html`), "utf8");
const PAGES: Record<string, string> = {
  "/ok": page("ok"),
  "/no-tracking": page("no-tracking"),
  "/injection": page("injection"),
  "/broken-links": page("broken-links"),
  "/noindex": page("noindex"),
};
const tiny = (title: string) => `<!doctype html><html lang="en"><head><title>${title}</title></head><body><h1>${title}</h1></body></html>`;
const HUGE_BYTES = 3 * 1024 * 1024;

function html(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
  res.end(res.req.method === "HEAD" ? undefined : body);
}
const redirect = (res: ServerResponse, status: number, location: string, headers: Record<string, string> = {}) => {
  res.writeHead(status, { location, ...headers });
  res.end();
};

export async function startFixtureSite(): Promise<FixtureSite> {
  if (process.env.URL_FETCH_ALLOW_PRIVATE !== "1" || process.env.NODE_ENV === "production") {
    throw new Error("The fixture site needs URL_FETCH_ALLOW_PRIVATE=1 and refuses NODE_ENV=production.");
  }
  const requests: string[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://fixture.local");
    const p = url.pathname;
    requests.push(`${req.method} ${p}`);
    if (PAGES[p]) {
      const headers: Record<string, string> =
        p === "/ok"
          ? { "strict-transport-security": "max-age=31536000", "content-security-policy": "frame-ancestors 'self'" }
          : p === "/noindex"
            ? { "x-robots-tag": "noindex" }
            : {};
      return html(res, 200, PAGES[p], headers);
    }
    if (p === "/about" || p === "/pricing") return html(res, 200, tiny(p.slice(1)));
    if (p === "/slow") {
      const timer = setTimeout(() => html(res, 200, tiny("slow")), Number(url.searchParams.get("ms") ?? 10_000));
      res.on("close", () => clearTimeout(timer));
      return;
    }
    if (p === "/error") return html(res, 500, tiny("Internal Server Error"));
    if (p === "/redirect-chain") return redirect(res, 301, "/redirect-chain/2");
    if (p === "/redirect-chain/2") return redirect(res, 302, "/redirect-chain/3");
    if (p === "/redirect-chain/3") return redirect(res, 307, "/ok");
    if (p === "/redirect-loop") return redirect(res, 302, "/redirect-loop/b");
    if (p === "/redirect-loop/b") return redirect(res, 302, "/redirect-loop");
    const many = /^\/redirect-many\/(\d+)$/.exec(p);
    if (many) return redirect(res, 302, Number(many[1]) > 0 ? `/redirect-many/${Number(many[1]) - 1}` : "/ok");
    if (p === "/redirect-to-private") return redirect(res, 302, "http://169.254.169.254/latest/meta-data/");
    if (p === "/set-cookie") return redirect(res, 302, "/headers", { "set-cookie": "session=abc; Path=/" });
    if (p === "/headers") {
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end(JSON.stringify(req.headers));
    }
    if (p === "/huge") {
      res.writeHead(200, { "content-type": "text/html" });
      const chunk = Buffer.alloc(64 * 1024, "a");
      let sent = 0;
      const pump = () => {
        while (sent < HUGE_BYTES && !res.destroyed) {
          sent += chunk.length;
          if (!res.write(chunk)) return void res.once("drain", pump);
        }
        res.end();
      };
      return pump();
    }
    // compressed body that stops mid-stream: /compressed-stall?enc=gzip|deflate|br hangs, /compressed-reset drops the socket
    if (p === "/compressed-stall" || p === "/compressed-reset") {
      const enc = url.searchParams.get("enc") ?? "gzip";
      const z = enc === "br" ? createBrotliCompress() : enc === "deflate" ? createDeflate() : createGzip();
      res.writeHead(200, { "content-type": "text/html", "content-encoding": enc });
      z.on("data", (chunk: Buffer) => res.write(chunk));
      z.write("<!doctype html><html><head><title>partial</title></head><body>" + "x".repeat(4096));
      z.flush(enc === "br" ? zlibConstants.BROTLI_OPERATION_FLUSH : zlibConstants.Z_SYNC_FLUSH, () => {
        if (p === "/compressed-reset") setTimeout(() => req.socket.destroy(), 50);
      });
      res.on("close", () => z.destroy());
      return;
    }
    if (p === "/download") {
      res.writeHead(200, { "content-type": "application/pdf" });
      return res.end(req.method === "HEAD" ? undefined : "%PDF-1.4 fixture");
    }
    if (p === "/head-not-allowed") {
      if (req.method === "HEAD") {
        res.writeHead(405);
        return res.end();
      }
      return html(res, 200, tiny("GET only"));
    }
    return html(res, 404, tiny("Not found"));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
