import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { UrlForm } from "@/components/url/url-form";
import { getHealth } from "@/lib/api";
import { URL_SCOPE_STATEMENT } from "@/lib/format";
import { runtimeOptions } from "@/lib/runtime-options";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "URL check" };

export default async function UrlCheckPage({ searchParams }: { searchParams: Promise<{ url?: string | string[] }> }) {
  const [{ url }, health] = await Promise.all([searchParams, getHealth()]);
  const initialUrl = (Array.isArray(url) ? url[0] : url) ?? "";
  return (
    <>
      <PageHeader title="URL check" description="Investigate a public landing page over live HTTP: status, timing, content, links and tags." />
      <div className="mt-6">
        <UrlForm scopeStatement={URL_SCOPE_STATEMENT} runtimes={runtimeOptions(health)} initialUrl={initialUrl.slice(0, 2048)} />
      </div>
    </>
  );
}
