// Links the API hands out (uploads, file previews, menu photos). With the web apps on another domain they must be
// absolute: set PUBLIC_API_URL=https://api.example.com. Empty keeps them relative (local dev / same server).
export const publicApiUrl = (path: string) => `${(process.env.PUBLIC_API_URL ?? '').replace(/\/+$/, '')}${path}`;

const LOCALHOST = /^http:\/\/localhost:\d+$/;

/** Browsers allowed to call the API: localhost (dev) + CORS_ORIGINS (comma-separated frontend URLs). Read per request. */
export function isAllowedOrigin(origin: string | undefined) {
  if (!origin) return true; // same-origin, curl, server-to-server
  if (LOCALHOST.test(origin)) return true;
  return (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean)
    .includes(origin);
}

/** For Nest's enableCors and Socket.IO's cors option. */
export const corsOrigin = (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => cb(null, isAllowedOrigin(origin));
