import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Built = { commit: string | null; commitDate: string | null; builtAt: string | null };

/**
 * What is running: package version + the commit the compiled code was built from (dist/build-info.json, written by
 * `pnpm build`). The folder's own git commit is kept as `checkout`: when the two differ, the server pulled new code
 * but the build didn't run, so the old code is still serving (stale).
 */
export function describeBuild(version: string, built: Built | null, checkout: { commit: string | null; commitDate: string | null }) {
  return {
    version,
    commit: built?.commit ?? checkout.commit,
    commitDate: built?.commitDate ?? checkout.commitDate,
    builtAt: built?.builtAt ?? null,
    checkout: checkout.commit,
    stale: !!(built?.commit && checkout.commit && built.commit !== checkout.commit),
    startedAt: new Date().toISOString(),
  };
}

function read() {
  let version = 'unknown';
  try {
    // src/common and dist/common are both two levels below apps/core-api.
    version = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')).version;
  } catch {
    /* keep unknown */
  }
  let built: Built | null = null;
  try {
    built = JSON.parse(readFileSync(resolve(__dirname, '../build-info.json'), 'utf8'));
  } catch {
    /* not built with `pnpm build` (dev watch, tests, or an older build) */
  }
  const checkout: { commit: string | null; commitDate: string | null } = { commit: null, commitDate: null };
  try {
    const out = execSync('git log -1 --format=%h%n%cI', { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).toString().trim().split('\n');
    [checkout.commit, checkout.commitDate] = [out[0] || null, out[1] || null];
  } catch {
    /* not a git checkout */
  }
  return describeBuild(version, built, checkout);
}

export const BUILD = read();
