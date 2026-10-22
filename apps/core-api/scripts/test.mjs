// Runs every src/**/*.spec.ts with tsx's test runner. Shell globs differ between Windows and Linux, so find them here.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(import.meta.dirname, '..');
const find = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? find(join(dir, e.name)) : e.name.endsWith('.spec.ts') ? [join(dir, e.name)] : []));
const files = find(join(root, 'src')).map((f) => relative(root, f));
if (!files.length) {
  console.error('No *.spec.ts files found');
  process.exit(1);
}
const r = spawnSync('npx', ['tsx', '--test', ...files], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(r.status ?? 1);
