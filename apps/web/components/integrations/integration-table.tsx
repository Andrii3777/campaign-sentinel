import { CircleCheck, CircleDashed, CircleHelp, FlaskConical, Settings2, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import type { IntegrationRow, LiveState } from "@/lib/integrations";
import type { VerificationStatus } from "@/lib/verification";

const verification: Record<VerificationStatus, { label: string; icon: typeof CircleCheck; tone: "ok" | "neutral" | "degraded" }> = {
  verified: { label: "Verified", icon: CircleCheck, tone: "ok" },
  configured: { label: "Configured", icon: Settings2, tone: "neutral" },
  not_configured: { label: "Not configured", icon: CircleDashed, tone: "neutral" },
  experimental: { label: "Experimental", icon: FlaskConical, tone: "degraded" },
  not_verified: { label: "Not verified", icon: CircleHelp, tone: "neutral" },
};

const live: Record<LiveState, { label: string; icon: typeof CircleCheck; tone: "ok" | "neutral" | "degraded" }> = {
  available: { label: "Available", icon: CircleCheck, tone: "ok" },
  configured: { label: "Configured", icon: CircleCheck, tone: "ok" },
  not_configured: { label: "Not configured", icon: CircleDashed, tone: "neutral" },
  missing_key: { label: "API key missing", icon: TriangleAlert, tone: "degraded" },
  unknown_provider: { label: "Unknown provider", icon: TriangleAlert, tone: "degraded" },
  unknown: { label: "API not reachable", icon: CircleHelp, tone: "neutral" },
};

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  const v = verification[status];
  return (
    <Badge icon={v.icon} tone={v.tone}>
      {v.label}
    </Badge>
  );
}

/** One group of integrations. Runtimes show what the running API reports; IDE clients have no live probe, so only the record speaks for them. */
export function IntegrationTable({ id, title, rows, showLive }: { id: string; title: string; rows: readonly IntegrationRow[]; showLive: boolean }) {
  return (
    <Card aria-labelledby={id}>
      <CardHeader id={id} title={title} />
      <Table>
        <thead>
          <tr>
            <Th>{showLive ? "Runtime" : "Client"}</Th>
            {showLive ? <Th>Live status</Th> : null}
            <Th>Verification</Th>
            <Th>Checked</Th>
            <Th>Evidence</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const l = row.live ? live[row.live.state] : null;
            return (
              <Tr key={row.id}>
                <Td className="min-w-56">
                  <span className="font-medium">{row.label}</span>
                  <p className="max-w-[44ch] text-xs text-ink-2">{row.description}</p>
                </Td>
                {showLive ? (
                  <Td>
                    {l ? (
                      <div className="flex flex-col items-start gap-1">
                        <Badge icon={l.icon} tone={l.tone}>
                          {l.label}
                        </Badge>
                        {row.live?.detail ? <span className="font-mono text-xs text-ink-2">{row.live.detail}</span> : null}
                      </div>
                    ) : null}
                  </Td>
                ) : null}
                <Td>
                  <VerificationBadge status={row.verification} />
                </Td>
                <Td className="whitespace-nowrap text-ink-2">{row.checkedAt ? <time dateTime={row.checkedAt}>{formatDateTime(row.checkedAt)}</time> : "—"}</Td>
                <Td className="max-w-72 text-xs break-words text-ink-2">{row.evidence ?? "—"}</Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </Card>
  );
}
