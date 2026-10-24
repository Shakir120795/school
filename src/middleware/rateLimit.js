// Minimal in-memory fixed-window rate limiter (single-instance deployments
// and the pilot). For multi-instance production, move counters to Redis —
// the interface (limit, windowMs, keyFn) stays the same.
const buckets = new Map();

export function rateLimit({ limit, windowMs, keyFn, name }) {
  return (req, res, next) => {
    const key = `${name}:${keyFn ? keyFn(req) : req.ip}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count++;
    if (bucket.count > limit) {
      res.setHeader("Retry-After", Math.ceil((bucket.resetAt - now) / 1000));
      return res.status(429).json({ error: "RATE_LIMITED" });
    }
    return next();
  };
}

// Periodic cleanup so the map cannot grow unboundedly.
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}, 60_000).unref();
