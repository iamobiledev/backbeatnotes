/**
 * Lightweight fixed-window rate limiter.
 *
 * Kept in process memory: on serverless this is per-function-instance, which
 * is a pragmatic first line of defense (Slack endpoints are additionally
 * protected by request-signature verification). Swap the store for
 * Redis/Upstash later without changing call sites.
 */

type WindowState = { count: number; resetAt: number };

const store = new Map<string, WindowState>();

const MAX_KEYS = 10_000;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  /** Milliseconds until the window resets. */
  retryAfterMs: number;
};

export function rateLimit(opts: {
  /** Unique key, e.g. `search:{userId}` or `slack:{teamId}`. */
  key: string;
  /** Max requests per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  now?: number;
}): RateLimitResult {
  const now = opts.now ?? Date.now();

  // Opportunistic cleanup to bound memory.
  if (store.size > MAX_KEYS) {
    for (const [key, state] of store) {
      if (state.resetAt <= now) store.delete(key);
    }
    if (store.size > MAX_KEYS) store.clear();
  }

  const state = store.get(opts.key);
  if (!state || state.resetAt <= now) {
    store.set(opts.key, { count: 1, resetAt: now + opts.windowMs });
    return { allowed: true, remaining: opts.limit - 1, retryAfterMs: 0 };
  }

  if (state.count >= opts.limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, state.resetAt - now),
    };
  }

  state.count += 1;
  return {
    allowed: true,
    remaining: opts.limit - state.count,
    retryAfterMs: 0,
  };
}

/** Test hook. */
export function resetRateLimits() {
  store.clear();
}
