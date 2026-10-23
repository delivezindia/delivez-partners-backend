import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// What is running: package version + git commit (read once at startup; the server deploys with git pull).
function read() {
  let version = 'unknown';
  try {
    // src/common and dist/common are both two levels below apps/core-api.
    version = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')).version;
  } catch {
    /* keep unknown */
  }
  let commit: string | null = null;
  let commitDate: string | null = null;
  try {
    const out = execSync('git log -1 --format=%h%n%cI', { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).toString().trim().split('\n');
    [commit, commitDate] = [out[0] || null, out[1] || null];
  } catch {
    /* not a git checkout */
  }
  return { version, commit, commitDate, startedAt: new Date().toISOString() };
}

export const BUILD = read();
