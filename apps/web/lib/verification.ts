import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

export const VerificationStatusSchema = z.enum(["verified", "configured", "not_configured", "experimental", "not_verified"]);
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

/** One line of `docs/verification.json`, written by the verification scripts. */
export const VerificationRecordSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  status: VerificationStatusSchema,
  checkedAt: z.string().optional(),
  evidence: z.string().optional(),
});
export type VerificationRecord = z.infer<typeof VerificationRecordSchema>;

export const VerificationFileSchema = z.array(VerificationRecordSchema);

export type VerificationLoad = { records: VerificationRecord[]; problem?: string };

/** A missing file is normal (nothing verified yet); a broken one is reported, never thrown and never half-trusted. */
export function parseVerification(raw: string | null): VerificationLoad {
  if (raw === null) return { records: [] };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { records: [], problem: "docs/verification.json is not valid JSON." };
  }
  const parsed = VerificationFileSchema.safeParse(json);
  if (parsed.success) return { records: parsed.data };
  const issue = parsed.error.issues[0];
  return { records: [], problem: `docs/verification.json does not match the record format (${issue?.path.join(".") || "root"}: ${issue?.message ?? "invalid"}).` };
}

/** Server-only. The file lives at the repo root; `next` runs from `apps/web`, so the default is two levels up. */
export function readVerification(): VerificationLoad {
  const file = process.env.VERIFICATION_FILE ?? resolve(process.cwd(), "../../docs/verification.json");
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { records: [] };
    return { records: [], problem: "docs/verification.json could not be read." };
  }
  return parseVerification(raw);
}
