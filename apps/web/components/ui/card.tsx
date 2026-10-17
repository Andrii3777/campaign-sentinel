import type { ComponentProps, ReactNode } from "react";

/** White surface on stone ground: 1 px hairline, 4 px radius, no shadow. */
export function Card({ className = "", ...props }: ComponentProps<"section">) {
  return <section className={`rounded-sm border border-hairline bg-surface ${className}`} {...props} />;
}

export function CardHeader({ title, actions, id }: { title: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <header className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-2">
      <h2 id={id} className="text-base font-semibold">
        {title}
      </h2>
      {actions}
    </header>
  );
}
