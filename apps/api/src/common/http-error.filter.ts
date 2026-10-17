import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { ApiError } from "@campaign-sentinel/contracts";
import type { Response } from "express";
import { LedgerError } from "../ledger/ledger.errors";

const CODE_BY_STATUS: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  422: "UNPROCESSABLE_ENTITY",
  429: "RATE_LIMITED",
};

/** Every error leaves the API as `{code, message, details?}` — never a stack trace. */
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger("HttpError");

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const [status, body] = this.toBody(exception);
    if (status >= 500) this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    res.status(status).json(body);
  }

  private toBody(exception: unknown): [number, ApiError] {
    if (exception instanceof LedgerError) {
      return [exception.status, { code: exception.code, message: exception.message }];
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const r = typeof response === "object" && response !== null ? (response as Record<string, unknown>) : {};
      const message = typeof r.message === "string" ? r.message : exception.message;
      const body: ApiError = { code: typeof r.code === "string" ? r.code : (CODE_BY_STATUS[status] ?? "HTTP_ERROR"), message };
      if (r.details !== undefined) body.details = r.details;
      return [status, body];
    }
    return [HttpStatus.INTERNAL_SERVER_ERROR, { code: "INTERNAL_ERROR", message: "Internal server error" }];
  }
}
