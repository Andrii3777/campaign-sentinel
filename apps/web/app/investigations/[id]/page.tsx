import type { Metadata } from "next";
import { LiveInvestigation } from "@/components/investigation/live-investigation";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { getInvestigation, getInvestigationEvents } from "@/lib/api";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Investigation" };

export default async function InvestigationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Detail first, then the events: a closing event that lands in between is picked up by the first poll.
  const detail = await getInvestigation(id);
  if (!detail.ok) return <Failure code={detail.error.code} message={detail.error.message} notFound={detail.error.status === 404} />;
  const events = await getInvestigationEvents(id, 0);
  if (!events.ok) return <Failure code={events.error.code} message={events.error.message} notFound={false} />;
  return <LiveInvestigation key={detail.data.id} initialDetail={detail.data} initialEvents={events.data.items} />;
}

function Failure({ code, message, notFound }: { code: string; message: string; notFound: boolean }) {
  return (
    <div className="pt-8">
      <Card>
        <ErrorState code={code} message={message} />
        {notFound ? (
          <div className="px-4 pb-6">
            <ButtonLink href="/investigations">Back to all investigations</ButtonLink>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
