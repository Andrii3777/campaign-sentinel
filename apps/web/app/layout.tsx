import type { Metadata } from "next";
import { JetBrains_Mono, Public_Sans } from "next/font/google";
import type { ReactNode } from "react";
import { AppRail } from "@/components/app-rail";
import "./globals.css";

const publicSans = Public_Sans({ subsets: ["latin"], variable: "--font-public-sans", display: "swap" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap", preload: false });

export const metadata: Metadata = {
  title: { default: "Campaign Sentinel", template: "%s · Campaign Sentinel" },
  description: "Investigate conversion drops in ad campaigns and landing pages, with every finding tied to evidence.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${publicSans.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-dvh bg-ground md:flex">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-10 focus:bg-surface focus:px-3 focus:py-2">
          Skip to content
        </a>
        <AppRail />
        <main id="main" className="min-w-0 flex-1 px-4 pb-16 md:px-8">
          <div className="mx-auto max-w-[1200px]">{children}</div>
        </main>
      </body>
    </html>
  );
}
