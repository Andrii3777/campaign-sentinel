import { createHash, timingSafeEqual } from "node:crypto";
import { type CanActivate, type ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { APP_CONFIG, type AppConfig } from "../../config/config";

// strictly host[:port] / scheme://host[:port]: no userinfo, path, query, fragment, escapes or lookalike suffixes
const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i;
const LOCAL_ORIGIN = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i;
const digest = (value: string) => createHash("sha256").update(value).digest();

/** Constant-time comparison: both sides are hashed to equal length first, so length does not leak. */
export function tokensEqual(given: string, expected: string): boolean {
  return timingSafeEqual(digest(given), digest(expected));
}

/**
 * Access boundary of the Agent API (spec 5.10, 7.2): bearer token, and, against DNS rebinding and
 * browser pages, a local `Host` and (when present) a local `Origin`. Responses never echo the token.
 */
@Injectable()
export class AgentGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const expected = this.config.SENTINEL_AGENT_TOKEN;
    const given = /^Bearer (\S+)$/i.exec(req.get("authorization") ?? "")?.[1];
    // an unset server token answers like a wrong one: the response must not reveal the server's configuration
    if (!expected || !given || !tokensEqual(given, expected)) {
      throw new UnauthorizedException({ code: "UNAUTHORIZED", message: "A valid bearer token is required." });
    }
    const origin = req.get("origin");
    if (!LOCAL_HOST.test(req.get("host") ?? "") || (origin !== undefined && !LOCAL_ORIGIN.test(origin))) {
      throw new ForbiddenException({ code: "FORBIDDEN_ORIGIN", message: "The Agent API only accepts requests addressed to and coming from localhost." });
    }
    return true;
  }
}
