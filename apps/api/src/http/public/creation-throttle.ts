import { Injectable } from "@nestjs/common";

const WINDOW_MS = 60_000;

/**
 * Spec §5.9: 10 creations/min per IP (URL mode 5/min). Sliding window in memory.
 * shortcut: per-process memory, keys never evicted beyond the window; move to a shared store when the API runs on several instances.
 */
@Injectable()
export class CreationThrottle {
  private readonly hits = new Map<string, number[]>();

  /** Records a hit for every key; false (nothing recorded) when any key is over its limit. */
  allow(limits: [key: string, limit: number][], now = Date.now()): boolean {
    const recent = limits.map(([key, limit]) => {
      const list = (this.hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
      this.hits.set(key, list);
      return list.length < limit;
    });
    if (recent.includes(false)) return false;
    for (const [key] of limits) this.hits.get(key)!.push(now);
    return true;
  }

  reset(): void {
    this.hits.clear();
  }
}
