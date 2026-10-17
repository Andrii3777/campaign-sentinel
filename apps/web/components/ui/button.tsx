import Link from "next/link";
import type { ComponentProps } from "react";

type Variant = "primary" | "secondary" | "ghost";

const base =
  "inline-flex h-9 items-center justify-center gap-2 rounded-sm px-3 text-sm font-semibold whitespace-nowrap transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";

const variants: Record<Variant, string> = {
  // Reserved orange: only the primary action of a screen.
  primary: "bg-reserved-fill text-white hover:bg-reserved-fill-hover",
  secondary: "border border-hairline bg-surface text-ink hover:border-ink-2",
  ghost: "text-ink hover:bg-ground",
};

export function buttonClass(variant: Variant = "secondary", className = "") {
  return `${base} ${variants[variant]} ${className}`;
}

export function Button({ variant = "secondary", className, type = "button", ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button type={type} className={buttonClass(variant, className)} {...props} />;
}

export function ButtonLink({ variant = "secondary", className, ...props }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={buttonClass(variant, className)} {...props} />;
}
