import { BadRequestException, ConflictException, HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  CreateInvestigationDtoSchema,
  DEFAULT_QUESTION,
  DEFAULT_URL_QUESTION,
  DEMO_DATASET_VERSION,
  TERMINAL_STATUSES,
  type InvestigationListItem,
  type InvestigationSource,
  type Period,
} from "@campaign-sentinel/contracts";
import type { z } from "zod";
import { APP_CONFIG, type AppConfig } from "../../config/config";
import { PrismaService } from "../../db/prisma.service";
import { CampaignDataRepository, type DemoCampaign } from "../../demo-data/campaign-data.repository";
import { InvestigationNotFoundError } from "../../ledger/ledger.errors";
import { LedgerService, type CreateInvestigationInput } from "../../ledger/ledger.service";
import { aiUnavailableReason, openclawStatus } from "../../runtime/providers/provider-config";
import { Runner } from "../../runtime/runner";
import { validateTargetUrl } from "../../web-inspection/url-guard";
import { CreationThrottle } from "./creation-throttle";
import { toListItem } from "./dto";

export interface FieldError {
  field: string;
  message: string;
}
export interface RequestMeta {
  ip: string;
  userAgent?: string;
  idempotencyKey?: string;
  source: InvestigationSource;
}

/** Spec §5.9 throttling: creations per minute per IP. */
export const CREATIONS_PER_MINUTE = 10;
export const URL_CREATIONS_PER_MINUTE = 5;
const MAX_PERIOD_DAYS = 31;
const date = (d: string) => new Date(`${d}T00:00:00.000Z`);
const days = (p: Period) => (date(p.end).getTime() - date(p.start).getTime()) / 86_400_000 + 1;

/** 400 `{code: "VALIDATION_ERROR", message, details: [{field, message}]}` (spec story 2). */
export function validationError(details: FieldError[]): BadRequestException {
  return new BadRequestException({ code: "VALIDATION_ERROR", message: details.map((d) => `${d.field}: ${d.message}`).join("; "), details });
}

/** Parses with zod or throws a 400 with one `{field, message}` per issue. */
export function parseOr400<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw validationError(parsed.error.issues.map((i) => ({ field: i.path.map(String).join(".") || "(body)", message: i.message })));
}

/** Story 2: periods inside the data range, at most 31 days each, current strictly after baseline. */
export function periodErrors(baseline: Period, current: Period, campaign: Pick<DemoCampaign, "dataStart" | "dataEnd">): FieldError[] {
  const errors: FieldError[] = [];
  for (const [name, p] of [["baseline", baseline], ["current", current]] as const) {
    if (p.start < campaign.dataStart) errors.push({ field: `${name}.start`, message: `Data starts on ${campaign.dataStart}.` });
    if (p.end > campaign.dataEnd) errors.push({ field: `${name}.end`, message: `Data ends on ${campaign.dataEnd}.` });
    if (days(p) > MAX_PERIOD_DAYS) errors.push({ field: `${name}.end`, message: `A period can be at most ${MAX_PERIOD_DAYS} days long.` });
  }
  if (current.start <= baseline.end) errors.push({ field: "current.start", message: "The current period must start after the baseline period ends." });
  return errors;
}

/** Public API use cases (spec §5.9): create (idempotent, throttled, validated), cancel, retry. */
@Injectable()
export class InvestigationsService {
  constructor(
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CampaignDataRepository) private readonly campaigns: CampaignDataRepository,
    @Inject(Runner) private readonly runner: Runner,
    @Inject(CreationThrottle) private readonly throttle: CreationThrottle,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async create(body: unknown, meta: RequestMeta): Promise<InvestigationListItem> {
    this.checkIdempotencyKey(meta);
    const dto = parseOr400(CreateInvestigationDtoSchema, body);
    const repeated = await this.existingByKey(meta);
    if (repeated) return repeated;
    this.requireRuntime(dto.runtime);
    this.throttleCreation(meta, dto.mode);

    const common = {
      source: meta.source,
      runtime: dto.runtime,
      clientUserAgent: meta.userAgent?.slice(0, 300),
      idempotencyKey: meta.idempotencyKey,
    };
    let input: CreateInvestigationInput;
    if (dto.mode === "demo") {
      const campaign = await this.campaigns.getCampaign(dto.campaignId);
      if (!campaign) throw validationError([{ field: "campaignId", message: "Unknown demo campaign." }]);
      const baseline = dto.baseline ?? campaign.defaultPeriods.baseline;
      const current = dto.current ?? campaign.defaultPeriods.current;
      const errors = periodErrors(baseline, current, campaign);
      if (errors.length) throw validationError(errors);
      input = {
        ...common,
        mode: "DEMO",
        campaignId: campaign.id,
        question: dto.question ?? DEFAULT_QUESTION,
        baselineStart: date(baseline.start),
        baselineEnd: date(baseline.end),
        currentStart: date(current.start),
        currentEnd: date(current.end),
        provenance: { kind: "synthetic-demo", dataset: DEMO_DATASET_VERSION },
      };
    } else {
      // story 39: refused before anything is fetched
      const check = await validateTargetUrl(dto.url, { allowLoopback: this.config.URL_FETCH_ALLOW_PRIVATE });
      if (!check.ok) throw new BadRequestException({ code: check.code, message: check.message });
      input = { ...common, mode: "URL", targetUrl: check.url.href, question: dto.question ?? DEFAULT_URL_QUESTION, provenance: { kind: "live-http" } };
    }
    const { investigation } = await this.ledger.create(input);
    this.runner.enqueue(investigation.id);
    return this.item(investigation.id);
  }

  private checkIdempotencyKey(meta: RequestMeta): void {
    if (meta.idempotencyKey !== undefined && (meta.idempotencyKey.length < 1 || meta.idempotencyKey.length > 200)) {
      throw validationError([{ field: "Idempotency-Key", message: "Must be 1–200 characters." }]);
    }
  }

  private async existingByKey(meta: RequestMeta): Promise<InvestigationListItem | null> {
    if (!meta.idempotencyKey) return null;
    const existing = await this.prisma.investigation.findUnique({ where: { idempotencyKey: meta.idempotencyKey }, select: { id: true } });
    return existing ? this.item(existing.id) : null;
  }

  private requireRuntime(runtime: "deterministic" | "ai" | "openclaw"): void {
    const unavailable = this.runtimeUnavailableReason(runtime);
    if (unavailable) throw new BadRequestException({ code: "RUNTIME_UNAVAILABLE", message: unavailable });
  }

  /** Creation and retry share one budget: 10 per minute per IP, URL runs 5 per minute. */
  private throttleCreation(meta: RequestMeta, mode: "demo" | "url"): void {
    const limits: [string, number][] = [[meta.ip, CREATIONS_PER_MINUTE]];
    if (mode === "url") limits.push([`${meta.ip}:url`, URL_CREATIONS_PER_MINUTE]);
    if (!this.throttle.allow(limits)) {
      throw new HttpException(
        { code: "RATE_LIMITED", message: "Too many investigations started from this address; try again in a minute." },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Story 66: the AI and OpenClaw options are disabled, with a reason, until configured. */
  private runtimeUnavailableReason(runtime: "deterministic" | "ai" | "openclaw"): string | null {
    if (runtime === "ai") return aiUnavailableReason(this.config);
    if (runtime === "openclaw" && openclawStatus(this.config) !== "configured") {
      return "OpenClaw is not configured: set OPENCLAW_GATEWAY_URL and OPENCLAW_GATEWAY_TOKEN in .env (see docs/openclaw.md).";
    }
    return null;
  }

  async cancel(id: string): Promise<InvestigationListItem> {
    await this.runner.cancel(id);
    return this.item(id);
  }

  /** A finished built-in run (deterministic, ai, openclaw) → a new linked QUEUED run with the same runtime and parameters (story 55). */
  async retry(id: string, meta: RequestMeta): Promise<InvestigationListItem> {
    const inv = await this.prisma.investigation.findUnique({ where: { id } });
    if (!inv) throw new InvestigationNotFoundError(id);
    if (!TERMINAL_STATUSES.includes(inv.status)) {
      throw new ConflictException({ code: "NOT_RETRYABLE", message: `The investigation is ${inv.status}; only finished runs can be retried.` });
    }
    if (inv.runtime === "external") {
      throw new ConflictException({ code: "NOT_RETRYABLE", message: "An external agent's run is retried by that agent: start a new investigation from it." });
    }
    const runtime = inv.runtime as "deterministic" | "ai" | "openclaw";
    this.checkIdempotencyKey(meta);
    const repeated = await this.existingByKey(meta);
    if (repeated) return repeated;
    this.requireRuntime(runtime);
    this.throttleCreation(meta, inv.mode === "URL" ? "url" : "demo");
    const { investigation } = await this.ledger.create({
      mode: inv.mode,
      campaignId: inv.campaignId ?? undefined,
      targetUrl: inv.targetUrl ?? undefined,
      question: inv.question,
      baselineStart: inv.baselineStart ?? undefined,
      baselineEnd: inv.baselineEnd ?? undefined,
      currentStart: inv.currentStart ?? undefined,
      currentEnd: inv.currentEnd ?? undefined,
      source: meta.source,
      runtime,
      clientUserAgent: meta.userAgent?.slice(0, 300),
      idempotencyKey: meta.idempotencyKey,
      retryOfId: inv.id,
      provenance: inv.provenance as CreateInvestigationInput["provenance"],
    });
    this.runner.enqueue(investigation.id);
    return this.item(investigation.id);
  }

  private async item(id: string): Promise<InvestigationListItem> {
    const inv = await this.prisma.investigation.findUnique({
      where: { id },
      include: { campaign: { select: { name: true } }, report: { select: { verdict: true, severity: true } } },
    });
    if (!inv) throw new InvestigationNotFoundError(id);
    return toListItem(inv);
  }
}
