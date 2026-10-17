import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div role="status" aria-label="Loading campaign">
      <div className="flex flex-col gap-3 border-b border-hairline pt-8 pb-4">
        <Skeleton className="h-7 w-80 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-6">
          <Card className="p-3">
            <SkeletonRows rows={3} label="Loading key figures" />
          </Card>
          <Card className="p-4">
            <Skeleton className="h-60 w-full" />
          </Card>
        </div>
        <Card className="p-4">
          <Skeleton className="h-64 w-full" />
        </Card>
      </div>
    </div>
  );
}
