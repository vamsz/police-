// Syntax-gates the browser frontend. ESLint's flat config can't lint a sibling
// directory, so the ES modules under ../web are validated with `node --check`,
// which parses each file exactly as the browser's module loader would.

import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const webJs = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'js');

function collect(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return collect(path);
    return entry.name.endsWith('.js') ? [path] : [];
  });
}

const files = collect(webJs);
let failed = 0;

for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    failed += 1;
    console.error(`✗ ${file}\n${err.stderr?.toString() ?? err.message}`);
  }
}

if (failed) {
  console.error(`\n${failed} frontend file(s) failed the syntax check.`);
  process.exit(1);
}
console.log(`✓ ${files.length} frontend modules parse cleanly.`);
