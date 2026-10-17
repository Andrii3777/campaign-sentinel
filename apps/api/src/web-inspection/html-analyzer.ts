import type { UntrustedContent } from "@campaign-sentinel/contracts";
import { parse, type HTMLElement } from "node-html-parser";
import { sanitizeUntrustedText, untrustedContent } from "../tools/untrusted-content";

export interface PageLink {
  url: string;
  sameSite: boolean;
  cta: boolean;
}

export interface PageForm {
  action: string | null;
  method: string;
  inputs: number;
  inputNames: string[];
}

export interface PageAnalysis {
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  robotsMeta: string | null;
  xRobotsTag: string | null;
  indexable: boolean;
  lang: string | null;
  viewport: string | null;
  h1: string[];
  wordCount: number;
  forms: PageForm[];
  ctaCount: number;
  linkCounts: { total: number; internal: number; external: number };
  /** absolute http(s) links without fragment, de-duplicated, in page order (at most MAX_LINKS) */
  links: PageLink[];
  trackers: { name: string; ids: string[] }[];
  /** http:// sub-resources of an https page */
  mixedContent: string[];
  security: { hsts: boolean; csp: boolean; xFrameOptions: boolean; xContentTypeOptions: boolean };
  /** title, description, h1 and the whole body text (hidden text included) for the agent to read as data */
  untrustedContent: UntrustedContent;
}

const MAX_LINKS = 200;
const MAX_FIELD = 200;
const MAX_HEADER_VALUE = 300;
const CTA_TEXT =
  /\b(get|start|sign ?up|buy|order|book|quote|subscribe|try|download|contact|apply|join|register|shop|claim|request|call)\b/i;
const CTA_CLASS = /\b(btn|button|cta)\b/i;

const TRACKERS: { name: string; present: RegExp; id?: RegExp }[] = [
  { name: "GA4", present: /googletagmanager\.com\/gtag\/js|gtag\s*\(/, id: /\bG-[A-Z0-9]{6,12}\b/g },
  { name: "GTM", present: /\bGTM-[A-Z0-9]{4,9}\b/, id: /\bGTM-[A-Z0-9]{4,9}\b/g },
  { name: "Meta Pixel", present: /connect\.facebook\.net\/[^"']*fbevents\.js|fbq\s*\(\s*['"]init/, id: /fbq\s*\(\s*['"]init['"]\s*,\s*['"](\d{5,20})['"]/g },
  { name: "TikTok Pixel", present: /analytics\.tiktok\.com|ttq\.load\s*\(/, id: /ttq\.load\s*\(\s*['"]([A-Z0-9]{6,30})['"]/g },
  { name: "LinkedIn Insight", present: /snap\.licdn\.com|_linkedin_partner_id/, id: /_linkedin_partner_id\s*=\s*['"]?(\d{3,12})/g },
  { name: "Hotjar", present: /static\.hotjar\.com|_hjSettings/, id: /hjid\s*:\s*(\d{3,12})/g },
];

/** Page strings go to the agent as data: sanitized and short (they are third-party text). */
const clean = (s: string | undefined | null) => {
  if (s == null) return null;
  const t = sanitizeUntrustedText(s).slice(0, MAX_FIELD);
  return t || null;
};

/** Response headers are attacker-controlled text: every value goes through the sanitizer and a length cap before an agent sees it. */
export function cleanHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.slice(0, 100), sanitizeUntrustedText(value).slice(0, MAX_HEADER_VALUE)]));
}

const siteOf = (host: string) => host.toLowerCase().replace(/^www\./, "");

function absolute(href: string | undefined, base: URL): URL | null {
  if (!href) return null;
  try {
    const u = new URL(href.trim(), base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u;
  } catch {
    return null;
  }
}

/** Pure HTML analysis of one fetched page (spec story 41). `headers` holds lower-cased response headers. */
export function analyzeHtml(html: string, page: { url: string; headers: Record<string, string> }): PageAnalysis {
  const base = new URL(page.url);
  const root = parse(html, { comment: false });
  const meta = (name: string) =>
    root.querySelectorAll("meta").find((m) => m.getAttribute("name")?.toLowerCase() === name)?.getAttribute("content");

  const title = clean(root.querySelector("title")?.innerHTML);
  const metaDescription = clean(meta("description"));
  const canonicalHref = root
    .querySelectorAll("link")
    .find((l) => l.getAttribute("rel")?.toLowerCase().split(/\s+/).includes("canonical"))
    ?.getAttribute("href");
  const robotsMeta = clean(meta("robots"));
  const rawXRobotsTag = page.headers["x-robots-tag"];
  const xRobotsTag = clean(rawXRobotsTag);
  const h1 = root.querySelectorAll("h1").map((h) => clean(h.innerHTML)).filter((t): t is string => t !== null);

  const forms: PageForm[] = root.querySelectorAll("form").map((f) => {
    const inputs = f.querySelectorAll("input, select, textarea");
    return {
      action: absolute(f.getAttribute("action") ?? "", base)?.href ?? null,
      method: (f.getAttribute("method") ?? "get").toLowerCase(),
      inputs: inputs.filter((i) => !/^(submit|button|reset|image)$/i.test(i.getAttribute("type") ?? "")).length,
      inputNames: inputs.map((i) => clean(i.getAttribute("name"))?.slice(0, 50)).filter((n): n is string => !!n),
    };
  });

  const isCta = (el: HTMLElement) => CTA_CLASS.test(el.getAttribute("class") ?? "") || CTA_TEXT.test(el.text);
  const buttons = root
    .querySelectorAll("button, input")
    .filter((el) => el.tagName === "BUTTON" || /^(submit|button)$/i.test(el.getAttribute("type") ?? ""));
  const anchors = root.querySelectorAll("a[href]");
  const ctaAnchors = anchors.filter(isCta);

  const links: PageLink[] = [];
  const seen = new Set<string>();
  let internal = 0;
  let external = 0;
  for (const a of anchors) {
    const u = absolute(a.getAttribute("href"), base);
    if (!u) continue;
    const sameSite = siteOf(u.hostname) === siteOf(base.hostname);
    if (seen.has(u.href)) continue;
    seen.add(u.href);
    if (sameSite) internal++;
    else external++;
    if (links.length < MAX_LINKS) links.push({ url: u.href, sameSite, cta: isCta(a) });
  }

  const trackers = TRACKERS.filter((t) => t.present.test(html)).map((t) => ({
    name: t.name,
    ids: t.id ? [...new Set([...html.matchAll(t.id)].map((m) => m[1] ?? m[0]))] : [],
  }));

  const mixedContent =
    base.protocol === "https:"
      ? [
          ...new Set(
            root
              .querySelectorAll("script[src], img[src], iframe[src], audio[src], video[src], source[src], embed[src], link[href]")
              .map((el) => el.getAttribute("src") ?? el.getAttribute("href") ?? "")
              .filter((src) => /^http:\/\//i.test(src.trim())),
          ),
        ]
          .map((src) => clean(src.trim()))
          .filter((src): src is string => src !== null)
          .slice(0, 50)
      : [];

  const body = root.querySelector("body") ?? root;
  for (const el of body.querySelectorAll("script, style, noscript, template")) el.remove();
  const visibleText = body.text.replace(/\s+/g, " ").trim();
  const header = [title && `Title: ${title}`, metaDescription && `Description: ${metaDescription}`, h1.length && `H1: ${h1.join(" | ")}`]
    .filter(Boolean)
    .join("\n");

  return {
    title,
    metaDescription,
    canonical: absolute(canonicalHref, base)?.href ?? null,
    robotsMeta,
    xRobotsTag,
    indexable: !/noindex|none/i.test(`${robotsMeta ?? ""} ${(rawXRobotsTag ?? "").slice(0, 2000)}`),
    lang: clean(root.querySelector("html")?.getAttribute("lang"))?.slice(0, 20) ?? null,
    viewport: clean(meta("viewport")),
    h1,
    wordCount: visibleText ? visibleText.split(" ").length : 0,
    forms,
    ctaCount: buttons.length + ctaAnchors.length,
    linkCounts: { total: internal + external, internal, external },
    links,
    trackers,
    mixedContent,
    security: {
      hsts: "strict-transport-security" in page.headers,
      csp: "content-security-policy" in page.headers,
      xFrameOptions: "x-frame-options" in page.headers,
      xContentTypeOptions: "x-content-type-options" in page.headers,
    },
    // body HTML, not the stripped text: hidden elements and comments must stay visible to the injection check
    untrustedContent: untrustedContent(`page:${base.href}`, `${header}\n${/<body[^>]*>([\s\S]*)/i.exec(html)?.[1] ?? html}`),
  };
}
