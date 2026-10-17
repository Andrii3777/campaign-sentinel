const DEFAULT_API_URL = "http://localhost:4000";

/** Server components talk to the API over the internal URL; the browser uses the public one. Kept apart from api.ts so client code does not pull in the contract schemas. */
export function apiBaseUrl(): string {
  const url = typeof window === "undefined" ? process.env.API_INTERNAL_URL : process.env.NEXT_PUBLIC_API_URL;
  return (url || DEFAULT_API_URL).replace(/\/+$/, "");
}
