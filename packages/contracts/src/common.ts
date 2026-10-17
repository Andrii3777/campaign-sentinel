import { z } from "zod";

export const IsoDateSchema = z.iso.date();

export const PeriodSchema = z
  .strictObject({ start: IsoDateSchema, end: IsoDateSchema })
  .refine((p) => p.start <= p.end, { message: "start must be on or before end", path: ["end"] });
export type Period = z.infer<typeof PeriodSchema>;

export const InvestigationModeSchema = z.enum(["demo", "url"]);
export type InvestigationMode = z.infer<typeof InvestigationModeSchema>;

export const EvidenceIdSchema = z.string().regex(/^E[1-9]\d*$/, "evidence id must look like E1, E2…");
export const HypothesisIdSchema = z.string().regex(/^H[1-9]\d*$/, "hypothesis id must look like H1, H2…");
