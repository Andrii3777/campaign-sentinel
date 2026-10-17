import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

/** Honest placeholder for a nav item whose screen lands in a later ticket: a title, no invented data. */
export function NotBuiltYet({ title, description }: { title: string; description: string }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card className="mt-6">
        <EmptyState message="This screen is not built yet. Nothing here is hidden or simulated — it will read from the API once it exists." />
      </Card>
    </>
  );
}
