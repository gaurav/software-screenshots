// Make node-pty's prebuilt `spawn-helper` executable, which npm does not.
//
// npm blocks node-pty's own install script, and that script is what sets the
// bit. Without it every spawn in term.mjs fails with a bare `posix_spawnp
// failed`: nothing about permissions, and node-pty still imports, so it reads
// like a Node ABI problem when it is a file mode. Approving node-pty's script
// does not replace this: what gets approved is `node-gyp rebuild`, and the
// prebuilt helper still lands non-executable. prcoder found both (its
// tools/postinstall.mjs, tested 2026-08-23), and this is that fix.
import { chmodSync, readdirSync } from 'node:fs';
import path from 'node:path';

const prebuilds = path.join(import.meta.dirname, '..', 'node_modules', 'node-pty', 'prebuilds');

// Missing is the only failure that means there is nothing to do: node-pty
// built from source, is not installed yet, or (Windows) ships no helper.
const unlessMissing = (fn) => {
  try { return fn(); } catch (e) { if (e.code !== 'ENOENT') throw e; }
};

for (const d of unlessMissing(() => readdirSync(prebuilds)) ?? []) {
  unlessMissing(() => chmodSync(path.join(prebuilds, d, 'spawn-helper'), 0o755));
}
