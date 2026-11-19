import { NextFunction, Request, Response } from 'express';

/**
 * In-Memory Sliding-Window Rate Limiter per Client IP & Route Bucket
 */

interface BucketEntry {
  timestamps: number[];
}

export function createRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
  bucketName: string;
}) {
  const store = new Map<string, BucketEntry>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const cutoff = now - options.windowMs;
    const ip =
      req.ip ||
      (typeof req.headers['x-forwarded-for'] === 'string'
        ? req.headers['x-forwarded-for'].split(',')[0].trim()
        : '') ||
      req.socket.remoteAddress ||
      'unknown';
    const key = `${options.bucketName}:${ip}`;

    let entry = store.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      store.set(key, entry);
    }

    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

    if (entry.timestamps.length >= options.maxRequests) {
      const oldest = entry.timestamps[0] || now;
      const retryAfterSec = Math.max(1, Math.ceil((oldest + options.windowMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        error: `Rate limit exceeded for ${options.bucketName}. Retry in ${retryAfterSec}s.`,
      });
      return;
    }

    entry.timestamps.push(now);

    if (store.size > 5000) {
      for (const [k, v] of store.entries()) {
        v.timestamps = v.timestamps.filter((t) => t > cutoff);
        if (v.timestamps.length === 0) store.delete(k);
      }
    }

    next();
  };
}
