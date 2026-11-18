import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { capture, parseMeta, retake, sidecarPath, viewportFor } from '../shot.mjs';

test('viewportFor follows the ratio', () => {
  assert.deepEqual(viewportFor('16:9', 1280), { width: 1280, height: 720 });
  assert.deepEqual(viewportFor('4:3', 1024), { width: 1024, height: 768 });
  assert.throws(() => viewportFor('wide', 1280), /W:H/);
  assert.throws(() => viewportFor('16:0', 1280), /W:H/);
  assert.throws(() => viewportFor('16:9', NaN), /whole number/);
});

test('sidecarPath and parseMeta', () => {
  assert.equal(sidecarPath('out/a.b.png'), 'out/a.b.json');
  assert.deepEqual(parseMeta(['pr=203', 'title=a=b']), { pr: '203', title: 'a=b' });
  assert.throws(() => parseMeta(['nokey']), /key=value/);
});

// PNG's IHDR holds the width and height as big-endian 32-bit integers at bytes 16 and 20.
const size = (png) => { const b = readFileSync(png); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test('capture writes a PNG of the ratio and a sidecar, and retake reproduces it', async (t) => {
  const { chromium } = await import('playwright');
  if (!existsSync(chromium.executablePath())) return t.skip('npx playwright install chromium');
  const out = path.join(mkdtempSync(path.join(os.tmpdir(), 'shot-test-')), 'page.png');
  const url = 'data:text/html,<title>Hello</title><h1 id=x>Hello</h1>';

  const s = await capture({ url, output: out, width: 640, scale: 2, waitFor: '#x', meta: { pr: '1' }, repo: '.' });
  assert.deepEqual(size(out), [1280, 720]);
  assert.equal(s.pageTitle, 'Hello');
  assert.match(s.subject.commit, /^[0-9a-f]{40}$/);
  assert.deepEqual(JSON.parse(readFileSync(sidecarPath(out), 'utf8')), s);

  // With a caption the page gives up the strip's height and the image keeps its ratio.
  const c = await capture({ url, output: out, width: 640, scale: 1, caption: 'url' });
  assert.deepEqual(size(out), [640, 360]);
  assert.equal(c.viewport.height, 332);

  // --setup runs against the page before the capture, and its path is kept for a retake.
  const setup = path.join(path.dirname(out), 'setup.mjs');
  writeFileSync(setup, "export default async (page) => { await page.evaluate(() => { document.title = 'Set up'; }); };\n");
  const withSetup = await capture({ url, output: path.join(path.dirname(out), 'setup.png'), width: 640, scale: 1, setup });
  assert.equal(withSetup.pageTitle, 'Set up');
  assert.equal(withSetup.options.setup, setup);
  assert.equal((await retake(sidecarPath(path.join(path.dirname(out), 'setup.png')))).pageTitle, 'Set up');

  const again = await retake(sidecarPath(out));
  assert.deepEqual(size(out), [640, 360]);
  assert.deepEqual({ ...again, capturedAt: 0 }, { ...c, capturedAt: 0 });
});
