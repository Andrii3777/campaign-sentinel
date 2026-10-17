"use client";

import type { CampaignDetail } from "@campaign-sentinel/contracts";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { findContact } from "@/lib/change-point";
import { formatChange, formatDay, formatInt, formatRate } from "@/lib/format";

// Hex copies of the tokens: SVG attributes inside Recharts are set from JS.
const TRACKED = "#7a4e2d"; // stratum tracking (umber)
const BACKEND = "#3e6a8a"; // stratum http (slate-blue)
const SESSIONS = "#4a5558"; // ink-2
const CONTACT = "#14191b";
const GRID = "#e4e7e4";
const AXIS = { fontSize: 12, fill: "#4a5558" };

type Daily = CampaignDetail["daily"][number];

function ChartTooltip({ active, payload, label }: Partial<TooltipContentProps>) {
  if (!active || !payload?.length) return null;
  const row = payload[0]!.payload as Daily;
  return (
    <div className="rounded-sm border border-hairline bg-surface px-3 py-2 text-xs">
      <p className="font-semibold">{formatDay(String(label))}</p>
      <p className="text-ink-2">Tracked CR {formatRate(row.trackedConversionRate)}</p>
      <p className="text-ink-2">Backend-confirmed CR {formatRate(row.backendConversionRate)}</p>
      <p className="text-ink-2">Sessions {formatInt(row.sessions)}</p>
    </div>
  );
}

/** Daily tracked vs backend-confirmed conversion rate, and sessions below on the same days. The dashed contact line is the detected change point. */
export default function TrendChart({ daily, baseline, current }: { daily: CampaignDetail["daily"]; baseline: { start: string; end: string }; current: { start: string; end: string } }) {
  const contact = findContact(daily);
  const summary = contact
    ? `Daily tracked conversion rate fell by ${formatChange(contact.relativeChange).replace("−", "")} from ${formatDay(contact.date)}.`
    : "Daily conversion rate shows no clear change point.";
  const common = { data: daily as Daily[], margin: { top: 8, right: 12, bottom: 0, left: 4 } };
  const xAxis = (hide: boolean) => <XAxis dataKey="date" tickFormatter={formatDay} tick={AXIS} tickLine={false} axisLine={{ stroke: "#b9c0bc" }} minTickGap={28} hide={hide} />;
  const contactLine = (label: boolean) =>
    contact ? (
      <ReferenceLine
        x={contact.date}
        stroke={CONTACT}
        strokeDasharray="5 4"
        strokeWidth={1.5}
        label={label ? { value: `Change point ${formatDay(contact.date)}`, position: "insideTopRight", fontSize: 12, fill: CONTACT, dy: 4, dx: -6 } : undefined}
      />
    ) : null;
  const periods = [
    <ReferenceArea key="b" x1={baseline.start} x2={baseline.end} fill="#f3f4f2" fillOpacity={1} ifOverflow="hidden" />,
    <ReferenceArea key="c" x1={current.start} x2={current.end} fill="#ffffff" fillOpacity={0} ifOverflow="hidden" />,
  ];

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-2" aria-label="Chart legend">
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-5" style={{ background: TRACKED }} />
          Tracked CR (pixel)
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-5" style={{ background: BACKEND }} />
          Backend-confirmed CR
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-5" style={{ background: SESSIONS }} />
          Sessions
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-5 border border-hairline bg-ground" />
          Baseline period
        </li>
        {contact ? (
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-3 w-5 border-l-[1.5px] border-dashed border-ink" />
            Detected change point
          </li>
        ) : null}
      </ul>

      <div role="img" aria-label={`Daily conversion rate, tracked and backend-confirmed. ${summary}`} className="h-60">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart {...common}>
            <CartesianGrid stroke={GRID} vertical={false} />
            {periods}
            {xAxis(true)}
            <YAxis tickFormatter={(v: number) => `${(v * 100).toFixed(1)}%`} tick={AXIS} tickLine={false} axisLine={false} width={64} domain={[0, "auto"]} label={{ value: "Conversion rate", angle: -90, position: "insideLeft", fontSize: 12, fill: "#4a5558", dx: -2 }} />
            <Tooltip content={ChartTooltip} cursor={{ stroke: "#b9c0bc" }} isAnimationActive={false} />
            {contactLine(true)}
            <Line type="monotone" dataKey="backendConversionRate" stroke={BACKEND} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="trackedConversionRate" stroke={TRACKED} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div role="img" aria-label="Daily sessions" className="h-36">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart {...common}>
            <CartesianGrid stroke={GRID} vertical={false} />
            {periods}
            {xAxis(false)}
            <YAxis tickFormatter={(v: number) => formatInt(v)} tick={AXIS} tickLine={false} axisLine={false} width={64} domain={[0, "auto"]} label={{ value: "Sessions", angle: -90, position: "insideLeft", fontSize: 12, fill: "#4a5558", dx: -2 }} />
            <Tooltip content={ChartTooltip} cursor={{ stroke: "#b9c0bc" }} isAnimationActive={false} />
            {contactLine(false)}
            <Line type="monotone" dataKey="sessions" stroke={SESSIONS} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <details className="rounded-sm border border-hairline">
        <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-ink-2 select-none hover:text-ink">Show the daily values as a table</summary>
        <div className="max-h-72 overflow-auto border-t border-hairline">
          <table className="w-full border-collapse text-left text-xs">
            <caption className="sr-only">Daily sessions, tracked conversions, backend conversions and conversion rates</caption>
            <thead className="sticky top-0 bg-surface">
              <tr>
                {["Date", "Sessions", "Tracked conv.", "Backend conv.", "Tracked CR", "Backend CR"].map((h, i) => (
                  <th key={h} scope="col" className={`border-b border-hairline px-3 py-1.5 font-semibold text-ink-2 ${i > 0 ? "text-right" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {daily.map((d) => (
                <tr key={d.date} className="border-b border-hairline">
                  <th scope="row" className="px-3 py-1 font-mono font-normal">
                    {d.date}
                  </th>
                  <td className="px-3 py-1 text-right">{formatInt(d.sessions)}</td>
                  <td className="px-3 py-1 text-right">{formatInt(d.trackedConversions)}</td>
                  <td className="px-3 py-1 text-right">{formatInt(d.backendConversions)}</td>
                  <td className="px-3 py-1 text-right">{formatRate(d.trackedConversionRate)}</td>
                  <td className="px-3 py-1 text-right">{formatRate(d.backendConversionRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
