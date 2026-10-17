import type { NextFunction, Request, Response } from "express";

/**
 * A POST that carries a body must say `application/json`. Browsers can send form-encoded and text/plain POSTs
 * cross-site without a CORS preflight, so refusing them keeps a foreign page from creating or cancelling runs.
 * A POST without a body (cancel, retry) passes.
 */
export function jsonBodiesOnly(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== "POST") return next();
  const type = req.headers["content-type"];
  const hasBody = req.headers["transfer-encoding"] !== undefined || Number(req.headers["content-length"] ?? 0) > 0;
  const json = typeof type === "string" && /^application\/json\s*(;|$)/i.test(type);
  if (json || (!type && !hasBody)) return next();
  res.status(415).json({ code: "UNSUPPORTED_MEDIA_TYPE", message: "Send the request body as application/json." });
}
