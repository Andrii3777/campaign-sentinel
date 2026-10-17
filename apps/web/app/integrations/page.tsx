import type { Metadata } from "next";
import { IntegrationTable } from "@/components/integrations/integration-table";
import { PageHeader } from "@/components/ui/page-header";
import { getHealth } from "@/lib/api";
import { buildIntegrationRows } from "@/lib/integrations";
import { readVerification } from "@/lib/verification";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const health = await getHealth();
  const { records, problem } = readVerification();
  const rows = buildIntegrationRows(health.ok ? health.data : null, records);

  return (
    <>
      <PageHeader title="Integrations" description="Which runtimes and IDE clients work, and how that was established. Live status comes from the running API; verification comes from the recorded checks." />
      <div className="mt-4 flex max-w-[72ch] flex-col gap-1 text-sm text-ink-2" role="status">
        {!health.ok ? (
          <p className="text-failed">
            The API did not answer, so live status is unknown · <code className="font-mono text-xs">{health.error.code}</code>
          </p>
        ) : null}
        {problem ? <p className="text-failed">{problem} Every entry is shown as not verified until it is fixed.</p> : null}
        {!problem && records.length === 0 ? <p>No verification record exists yet (docs/verification.json), so nothing is claimed as verified.</p> : null}
      </div>

      <div className="mt-6 flex flex-col gap-6">
        <IntegrationTable id="runtimes-heading" title="Runtimes" rows={rows.filter((r) => r.kind === "runtime")} showLive />
        <IntegrationTable id="clients-heading" title="IDE clients" rows={rows.filter((r) => r.kind === "client")} showLive={false} />
        <dl className="grid max-w-[72ch] gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="font-semibold">Verified</dt>
          <dd className="text-ink-2">A recorded check ran against a real install and its result is stored in the verification record.</dd>
          <dt className="font-semibold">Configured</dt>
          <dd className="text-ink-2">The configuration is in place; it was not exercised by an automated check.</dd>
          <dt className="font-semibold">Experimental</dt>
          <dd className="text-ink-2">Built to the vendor&apos;s documentation but not confirmed on a real install.</dd>
          <dt className="font-semibold">Not configured</dt>
          <dd className="text-ink-2">Missing a setting or key; the entry says which one.</dd>
          <dt className="font-semibold">Not verified</dt>
          <dd className="text-ink-2">No record exists for this entry.</dd>
        </dl>
      </div>
    </>
  );
}
