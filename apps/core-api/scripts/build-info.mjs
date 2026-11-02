// Runs after `nest build`: records which commit the compiled code (dist/) was built from, so the API reports
// what is actually running — not just what the folder was last pulled to.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// (import.meta.dirname needs Node 20.11+; this works on any Node a server may have.)
const root = fileURLToPath(new URL('..', import.meta.url));
let commit = null;
let commitDate = null;
try {
  [commit, commitDate] = execSync('git log -1 --format=%h%n%cI', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split('\n');
} catch {
  /* not a git checkout */
}
writeFileSync(new URL('../dist/build-info.json', import.meta.url), JSON.stringify({ commit, commitDate, builtAt: new Date().toISOString() }) + '\n');
console.log(`build-info: ${commit ?? 'no git commit'}`);
