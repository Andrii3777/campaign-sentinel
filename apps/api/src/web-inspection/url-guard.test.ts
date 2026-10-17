import { describe, expect, it } from "vitest";
import { isBlockedAddress, validateTargetUrl, type Resolver } from "./url-guard";

const PUBLIC = "93.184.215.14";
const resolveTo =
  (...addresses: string[]): Resolver =>
  async () =>
    addresses;
const noDns: Resolver = async (host) => {
  throw new Error(`unexpected DNS lookup of ${host}`);
};

describe("isBlockedAddress (spec §7.3 ranges)", () => {
  it.each([
    "127.0.0.1",
    "127.255.255.254",
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "169.254.0.1",
    "100.64.0.1",
    "100.127.255.255",
    "0.0.0.0",
    "0.1.2.3",
    "224.0.0.1",
    "239.255.255.250",
    "240.0.0.1",
    "255.255.255.255",
    "192.0.2.10",
    "198.18.0.1",
    "::1",
    "::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:169.254.169.254",
    "::ffff:7f00:1",
    "::ffff:a9fe:a9fe",
    "64:ff9b::a00:1",
    // B1: IPv6 transition ranges that embed an IPv4 address
    "2002:7f00:1::", // 6to4 of 127.0.0.1
    "2002:a00:1::", // 6to4 of 10.0.0.1
    "2002:808:808::", // 6to4 of a public address: the whole range is refused
    "2001:0:4136:e378:8000:63bf:3fff:fdd2", // Teredo
    "2001::1",
    "::ffff:0:7f00:1", // SIIT of 127.0.0.1
    "::ffff:0:a00:1",
    "::ffff:0:0:0",
    "64:ff9b:1::7f00:1",
    "64:ff9b:1:ffff::1",
  ])("blocks %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each([PUBLIC, "8.8.8.8", "172.32.0.1", "100.128.0.1", "2606:2800:21f:cb07:6820:80da:af6b:8b2c", "::ffff:8.8.8.8", "2001:4860:4860::8888", "2003::1"])(
    "allows public %s",
    (ip) => {
      expect(isBlockedAddress(ip)).toBe(false);
    },
  );

  it("treats garbage as blocked", () => {
    expect(isBlockedAddress("not-an-ip")).toBe(true);
  });
});

describe("validateTargetUrl", () => {
  it("accepts a public https URL and returns the pinned address", async () => {
    const r = await validateTargetUrl("https://example.com/landing?x=1", { resolve: resolveTo(PUBLIC) });
    expect(r).toMatchObject({ ok: true, address: PUBLIC });
    if (r.ok) expect(r.url.href).toBe("https://example.com/landing?x=1");
  });

  it.each([
    ["ftp://example.com/", "UNSUPPORTED_SCHEME"],
    ["javascript:alert(1)", "UNSUPPORTED_SCHEME"],
    ["file:///etc/passwd", "UNSUPPORTED_SCHEME"],
    ["https://user:pw@example.com/", "CREDENTIALS_IN_URL"],
    ["https://user@example.com/", "CREDENTIALS_IN_URL"],
    ["https://example.com:8080/", "PORT_NOT_ALLOWED"],
    ["http://example.com:22/", "PORT_NOT_ALLOWED"],
    [`https://example.com/${"a".repeat(2048)}`, "URL_TOO_LONG"],
    ["not a url", "INVALID_URL"],
  ])("refuses %s with %s and fetches nothing", async (raw, code) => {
    const r = await validateTargetUrl(raw, { resolve: noDns });
    expect(r).toMatchObject({ ok: false, code });
  });

  it.each([
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://0.0.0.0/",
    "http://10.1.2.3/",
    "http://100.64.1.1/",
    "http://224.0.0.1/",
    "http://[::1]/",
    "http://[fd00::1]/",
    "http://[fe80::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:169.254.169.254]/",
    "http://2130706433/",
    "http://0x7f.1/",
    "http://[2002:7f00:1::]/",
    "http://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/",
    "http://[::ffff:0:7f00:1]/",
    "http://[64:ff9b:1::1]/",
  ])("refuses IP literal %s without DNS", async (raw) => {
    const r = await validateTargetUrl(raw, { resolve: noDns });
    expect(r).toMatchObject({ ok: false, code: "BLOCKED_ADDRESS", blocked: true });
  });

  it.each(["127.0.0.1", "10.0.0.5", "169.254.169.254", "100.100.100.200", "::1", "fd00::5", "::ffff:192.168.0.1"])(
    "refuses a hostname resolving to %s",
    async (ip) => {
      const r = await validateTargetUrl("https://internal.example/", { resolve: resolveTo(ip) });
      expect(r).toMatchObject({ ok: false, code: "BLOCKED_ADDRESS", blocked: true });
    },
  );

  it("refuses when any of several resolved addresses is private", async () => {
    const r = await validateTargetUrl("https://mixed.example/", { resolve: resolveTo(PUBLIC, "10.0.0.1") });
    expect(r).toMatchObject({ ok: false, code: "BLOCKED_ADDRESS" });
  });

  it("converts IDN to punycode before resolving", async () => {
    const seen: string[] = [];
    const r = await validateTargetUrl("https://bücher.example/", {
      resolve: async (h) => {
        seen.push(h);
        return [PUBLIC];
      },
    });
    expect(seen).toEqual(["xn--bcher-kva.example"]);
    expect(r.ok && r.url.hostname).toBe("xn--bcher-kva.example");
  });

  it("reports a DNS failure as not blocked", async () => {
    const r = await validateTargetUrl("https://nx.example/", {
      resolve: async () => {
        throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
      },
    });
    expect(r).toMatchObject({ ok: false, code: "DNS_FAILURE", blocked: false });
  });

  it("B5: the DNS lookup races the abort signal", async () => {
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 50);
    const never: Resolver = () => new Promise(() => {});
    const before = Date.now();
    const r = await validateTargetUrl("https://slow-dns.example/", { resolve: never, signal: abort.signal });
    expect(Date.now() - before).toBeLessThan(1_000);
    expect(r).toMatchObject({ ok: false, code: "DNS_FAILURE", blocked: false });
  });

  it("allowLoopback admits loopback on any port but still refuses other private ranges", async () => {
    expect(await validateTargetUrl("http://127.0.0.1:45123/ok", { allowLoopback: true, resolve: noDns })).toMatchObject({
      ok: true,
      address: "127.0.0.1",
    });
    expect(await validateTargetUrl("http://10.0.0.1/", { allowLoopback: true, resolve: noDns })).toMatchObject({
      ok: false,
      code: "BLOCKED_ADDRESS",
    });
    expect(await validateTargetUrl("http://169.254.169.254/", { allowLoopback: true, resolve: noDns })).toMatchObject({
      ok: false,
    });
    expect(
      await validateTargetUrl("https://example.com:8443/", { allowLoopback: true, resolve: resolveTo(PUBLIC) }),
    ).toMatchObject({ ok: false, code: "PORT_NOT_ALLOWED" });
  });
});
