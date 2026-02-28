export type RateLimitDecision = { allowed: boolean; remaining: number; retryAfterSeconds: number };

/** Fixed-window limiter suitable for a single function instance; use a shared store for multi-region deployments. */
export class RateLimiter {
  private readonly buckets = new Map<string, { startedAt: number; count: number }>();
  constructor(private readonly limit = 120, private readonly windowMs = 60_000) {}
  consume(key: string, now = Date.now()): RateLimitDecision {
    const current = this.buckets.get(key);
    const bucket = !current || now - current.startedAt >= this.windowMs ? { startedAt: now, count: 0 } : current;
    bucket.count += 1; this.buckets.set(key, bucket);
    const allowed = bucket.count <= this.limit;
    return { allowed, remaining: Math.max(0, this.limit - bucket.count), retryAfterSeconds: allowed ? 0 : Math.ceil((this.windowMs - (now - bucket.startedAt)) / 1000) };
  }
}
