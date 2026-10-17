import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req } from "@nestjs/common";
import {
  EventsQuerySchema,
  ListInvestigationsQuerySchema,
  type EventType,
  type EventsResponse,
  type InvestigationDetail,
  type InvestigationListItem,
  type InvestigationListResponse,
} from "@campaign-sentinel/contracts";
import type { Request } from "express";
import { PrismaService } from "../../db/prisma.service";
import { InvestigationNotFoundError } from "../../ledger/ledger.errors";
import { LedgerService } from "../../ledger/ledger.service";
import { toDetail, toListItem } from "./dto";
import { InvestigationsService, parseOr400, type RequestMeta } from "./investigations.service";

/** The web UI sends `X-Sentinel-Client: web`; any other caller of the public API is recorded as source `api`. */
const meta = (req: Request, idempotencyKey?: string): RequestMeta => ({
  ip: req.ip ?? "unknown",
  userAgent: req.get("user-agent") ?? undefined,
  idempotencyKey,
  source: req.get("x-sentinel-client") === "web" ? "web" : "api",
});

/** Public API (spec §5.9). Errors leave as `{code, message, details?}` through HttpErrorFilter. */
@Controller("investigations")
export class InvestigationsController {
  constructor(
    @Inject(InvestigationsService) private readonly service: InvestigationsService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Post()
  @HttpCode(201)
  create(@Body() body: unknown, @Req() req: Request, @Headers("idempotency-key") key?: string): Promise<InvestigationListItem> {
    return this.service.create(body, meta(req, key));
  }

  @Get()
  async list(@Query() query: unknown): Promise<InvestigationListResponse> {
    const q = parseOr400(ListInvestigationsQuerySchema, query);
    const { items, nextCursor } = await this.ledger.listInvestigations({
      limit: q.limit,
      cursor: q.cursor,
      mode: q.mode === undefined ? undefined : q.mode === "demo" ? "DEMO" : "URL",
      status: q.status,
    });
    return { items: items.map(toListItem), nextCursor };
  }

  @Get(":id")
  async detail(@Param("id") id: string): Promise<InvestigationDetail> {
    const inv = await this.ledger.getInvestigation(id);
    if (!inv) throw new InvestigationNotFoundError(id);
    return toDetail(inv);
  }

  @Get(":id/events")
  async events(@Param("id") id: string, @Query() query: unknown): Promise<EventsResponse> {
    const { after } = parseOr400(EventsQuerySchema, query);
    // status is read first: events written after this read are picked up by the next poll
    const inv = await this.prisma.investigation.findUnique({ where: { id }, select: { status: true } });
    if (!inv) throw new InvestigationNotFoundError(id);
    const events = await this.ledger.getEventsAfter(id, after);
    return {
      status: inv.status,
      items: events.map((e) => ({
        id: e.id,
        investigationId: e.investigationId,
        seq: e.seq,
        type: e.type as EventType,
        at: e.at.toISOString(),
        payload: e.payload,
      })),
    };
  }

  @Post(":id/cancel")
  @HttpCode(200)
  cancel(@Param("id") id: string): Promise<InvestigationListItem> {
    return this.service.cancel(id);
  }

  @Post(":id/retry")
  @HttpCode(201)
  retry(@Param("id") id: string, @Req() req: Request, @Headers("idempotency-key") key?: string): Promise<InvestigationListItem> {
    return this.service.retry(id, meta(req, key));
  }
}
