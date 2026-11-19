import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { capture, retake } from '../shot.mjs';
import { bestColumns, captureSheet, fill, readFrames, writeIndex } from '../sheet.mjs';

const size = (png) => { const b = readFileSync(png); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test('fill takes its keys from the sidecar, and meta wins', () => {
  const s = { image: 'a_b.png', capturedAt: '2026-11-19T06:00:00.000Z', finalUrl: 'http://x/', pageTitle: 'X',
    subject: { commit: '0123456789abcdef', commitDate: '2026-10-14T20:00:00-04:00' }, meta: { pr: '140' } };
  assert.equal(fill('{name} {date} {commit} #{pr} {title} {nothing}.', s), 'a_b 2026-10-14 01234567 #140 X .');
  assert.equal(fill('{date}', { ...s, subject: null }), '2026-11-19');
  assert.equal(fill('{date}', { ...s, meta: { date: '2026-10-15' } }), '2026-10-15');
  assert.equal(fill('{command}', { ...s, terminal: { shown: 'milestones' } }), 'milestones');
});

test('bestColumns makes the thumbnails as large as the box allows', () => {
  assert.equal(bestColumns(9, 16 / 9, 1280, 720), 3);
  assert.equal(bestColumns(10, 16 / 9, 1280, 720), 4);
  assert.equal(bestColumns(3, 16 / 9, 300, 1200), 1);
  assert.equal(bestColumns(1, 16 / 9, 1280, 720), 1);
});

test('index and sheet are made from a directory of frames', async (t) => {
  const { chromium } = await import('playwright');
  if (!existsSync(chromium.executablePath())) return t.skip('npx playwright install chromium');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'shot-sheet-test-'));
  const page = (colour) => `data:text/html,<title>${colour}</title><body style="background:${colour}">`;
  await capture({ url: page('red'), output: path.join(dir, '02_red.png'), width: 320, scale: 1, meta: { pr: '2', note: 'a | b' } });
  await capture({ url: page('blue'), output: path.join(dir, '01_blue.png'), width: 320, scale: 1, meta: { pr: '1' }, repo: '.' });
  writeFileSync(path.join(dir, 'notes.json'), '{"not": "a sidecar"}');

  assert.deepEqual(readFrames(dir).map((s) => s.image), ['01_blue.png', '02_red.png']);

  writeIndex(dir, { title: 'Two', intro: 'Both of them.', columns: [['File', '{image}'], ['PR', '[#{pr}](https://x/{pr})'], ['Page', '{title}']] });
  assert.equal(readFileSync(path.join(dir, 'README.md'), 'utf8'), `# Two

Both of them.

| File | PR | Page |
| --- | --- | --- |
| 01_blue.png | [#1](https://x/1) | blue |
| 02_red.png | [#2](https://x/2) | red |
`);
  // With no columns named: the file, the commit when a frame has one, and every meta key.
  writeIndex(dir);
  const [, , heading, , first, second] = readFileSync(path.join(dir, 'README.md'), 'utf8').split('\n');
  assert.equal(heading, '| File | Commit | pr | note |');
  assert.match(first, /^\| 01_blue\.png \| [0-9a-f]{8} \| 1 \|  \|$/);
  assert.equal(second, '| 02_red.png |  | 2 | a \\| b |');

  const out = path.join(dir, 'sheet.png');
  const s = await captureSheet({ dir, output: out, width: 640, scale: 1, label: '#{pr}', title: 'Two' });
  assert.deepEqual(size(out), [640, 360]);
  assert.deepEqual(s.sheet.frames, ['01_blue.png', '02_red.png']);
  // The sheet lives among the frames it is of, and is not one of them.
  assert.equal(readFrames(dir).length, 2);
  const again = await retake(path.join(dir, 'sheet.json'));
  assert.deepEqual(again.sheet, s.sheet);
  assert.deepEqual(readFileSync(out).length > 0 && size(out), [640, 360]);

  await assert.rejects(captureSheet({ dir: mkdtempSync(path.join(os.tmpdir(), 'empty-')), output: out }), /no frames/);
});
