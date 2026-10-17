import { z } from "zod";
import { EvidenceIdSchema } from "./common";
import { EvidenceStrengthSchema } from "./investigation";

export const UntrustedContentSchema = z.object({
  notice: z.string(),
  source: z.string(),
  text: z.string(),
  injectionSignals: z.array(z.string()),
});
export type UntrustedContent = z.infer<typeof UntrustedContentSchema>;

export const ToolErrorSchema = z.object({ code: z.string(), message: z.string(), retryable: z.boolean() });
export type ToolError = z.infer<typeof ToolErrorSchema>;

export const ToolResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    data: z.unknown(),
    evidence: z.array(z.object({ ref: EvidenceIdSchema, statement: z.string(), strength: EvidenceStrengthSchema })),
    warnings: z.array(z.string()).optional(),
    untrustedContent: UntrustedContentSchema.optional(),
  }),
  z.object({ ok: z.literal(false), error: ToolErrorSchema }),
]);
export type ToolResult = z.infer<typeof ToolResultSchema>;
