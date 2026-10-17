import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";

/** Structural skeleton of the page: header, the strip beside its timeline, the evidence column. */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading investigation">
      <div className="flex flex-col gap-3 border-b border-hairline pt-8 pb-5">
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-4 w-96 max-w-full" />
        <Skeleton className="h-6 w-80 max-w-full" />
      </div>
      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,64fr)_minmax(0,36fr)]">
        <Card className="flex gap-3 p-3">
          <Skeleton className="h-64 w-7 shrink-0" />
          <div className="flex-1">
            <SkeletonRows rows={6} label="Loading timeline" />
          </div>
        </Card>
        <Card className="p-3">
          <SkeletonRows rows={4} label="Loading evidence" />
        </Card>
      </div>
    </div>
  );
}
