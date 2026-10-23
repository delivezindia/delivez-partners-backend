import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** Swagger lives at /docs plus its raw spec files; all of them need the same protection. */
export const DOCS_PATHS = ['/docs', '/docs-json', '/docs-yaml'];

/**
 * API docs visibility. Development: open. Production: only with DOCS_USERNAME + DOCS_PASSWORD set (browser login box);
 * without them the docs are not served at all.
 */
export function docsMode(env: NodeJS.ProcessEnv = process.env): 'open' | 'password' | 'off' {
  if (env.NODE_ENV !== 'production') return 'open';
  return env.DOCS_USERNAME && env.DOCS_PASSWORD ? 'password' : 'off';
}

// Compare hashes so the check takes the same time whatever the input length.
const same = (a: string, b: string) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

/** HTTP Basic auth for the docs (the browser shows its own username/password box). */
export function docsBasicAuth(username: string, password: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const [scheme, encoded] = (req.headers.authorization ?? '').split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const i = decoded.indexOf(':');
      if (i > 0 && same(decoded.slice(0, i), username) && same(decoded.slice(i + 1), password)) return next();
    }
    // Small delay on every failure slows down password guessing.
    setTimeout(() => {
      res.setHeader('WWW-Authenticate', 'Basic realm="Delivez API docs", charset="UTF-8"');
      res.status(401).send('Login required to view the Delivez API docs.');
    }, 800);
  };
}
