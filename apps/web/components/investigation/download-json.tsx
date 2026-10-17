"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Builds the file on click so the page does not carry the whole JSON twice. */
export function DownloadJson({ value, filename }: { value: unknown; filename: string }) {
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Button onClick={download}>
      <Download aria-hidden />
      Download JSON
    </Button>
  );
}
