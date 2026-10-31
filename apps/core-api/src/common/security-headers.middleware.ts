import type { NextFunction, Request, Response } from 'express';

// Hardening headers on every response. Uploaded files (/v1/files/…) stay frameable: the ops console and the
// shop app preview documents and prescriptions in an iframe. HSTS only in production, where nginx serves HTTPS.
export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (!req.path.startsWith('/v1/files/')) res.setHeader('X-Frame-Options', 'DENY');
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  next();
}
