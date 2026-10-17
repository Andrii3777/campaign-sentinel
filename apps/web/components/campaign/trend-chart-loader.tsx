"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

/** Recharts is large and only this page uses it: load it after the page shell, in the browser only. */
export const TrendChart = dynamic(() => import("./trend-chart"), {
  ssr: false,
  loading: () => (
    <div role="status" aria-label="Loading chart" className="flex flex-col gap-2">
      <Skeleton className="h-60 w-full" />
      <Skeleton className="h-36 w-full" />
    </div>
  ),
});
