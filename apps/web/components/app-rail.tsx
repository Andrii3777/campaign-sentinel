"use client";

import { Gauge, Globe, History, LayoutList, Menu, Plug, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const nav = [
  { href: "/", label: "Overview", icon: Gauge },
  { href: "/campaigns", label: "Campaigns", icon: LayoutList },
  { href: "/investigate/url", label: "URL check", icon: Globe },
  { href: "/investigations", label: "Investigations", icon: History },
  { href: "/integrations", label: "Integrations", icon: Plug },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Slate rail on desktop; under 768 px a top bar whose menu opens the same list. */
export function AppRail() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      menuButton.current?.focus(); // the links it was on are about to be hidden
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="bg-rail text-rail-ink md:sticky md:top-0 md:h-dvh md:w-56 md:shrink-0">
      <div className="flex h-14 items-center justify-between px-4 md:h-16">
        <Link href="/" className="text-base font-semibold tracking-[-0.01em] text-rail-ink" onClick={() => setOpen(false)}>
          Campaign Sentinel
        </Link>
        <button
          ref={menuButton}
          type="button"
          className="inline-flex size-9 items-center justify-center rounded-sm text-rail-ink hover:bg-rail-raised md:hidden"
          aria-expanded={open}
          aria-controls="primary-nav"
          aria-label={open ? "Close navigation" : "Open navigation"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}
        </button>
      </div>
      <nav id="primary-nav" aria-label="Primary" className={`${open ? "block" : "hidden"} border-t border-rail-raised pb-3 md:block md:border-0`}>
        <ul className="flex flex-col gap-0.5 px-2 pt-2">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  className={`flex h-9 items-center gap-3 rounded-sm px-3 text-sm transition-colors duration-150 ${
                    active ? "bg-rail-raised font-semibold text-rail-ink" : "text-rail-ink-2 hover:bg-rail-raised/60 hover:text-rail-ink"
                  }`}
                >
                  <Icon aria-hidden className="size-4 shrink-0" />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
