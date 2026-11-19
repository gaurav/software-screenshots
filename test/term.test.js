import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { retake, sidecarPath } from '../shot.mjs';
import { captureTerminal, plain, record, spawnPty } from '../term.mjs';

const size = (png) => { const b = readFileSync(png); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test('plain takes the escape sequences out', () => {
  assert.equal(plain('\x1b[1;31mred\x1b[0m \x1b]8;;http://x\x07link\x1b]8;;\x07'), 'red link');
});

test('a command in a pty sees a terminal of the size asked for, and keeps its colour', async () => {
  const { data, exitCode } = await record(['sh', '-c', 'test -t 1 && printf "\\033[32mtty\\033[0m "; stty size; exit 3'], { cols: 91, rows: 17 });
  assert.equal(data.toString(), '\x1b[32mtty\x1b[0m 17 91\r\n');
  assert.equal(exitCode, 3);
});

test('record stops a command that does not end, on a match or a timeout', async () => {
  const waiting = ['sh', '-c', 'echo ready on port 8377; sleep 60'];
  const matched = await record(waiting, { until: /port (\d+)/ });
  assert.match(matched.data.toString(), /ready on port 8377/);
  assert.equal(matched.exitCode, null);
  assert.equal((await record(waiting, { timeout: 300 })).exitCode, null);
  await assert.rejects(record(['sh', '-c', 'echo no'], { until: /yes/ }), /exited \(0\) before its output matched/);
});

test('spawnPty.waitFor answers the match while the command is still running', async () => {
  const child = await spawnPty(['sh', '-c', 'printf "at \\033[1mhttp://127.0.0.1:1/#t=abc\\033[0m\\n"; sleep 60']);
  try {
    assert.equal((await child.waitFor(/http:\S+/))[0], 'http://127.0.0.1:1/#t=abc');
  } finally { child.kill(); }
  assert.notEqual((await child.exited).signal, 0);
});

test('captureTerminal writes a PNG of the ratio, the bytes, and a sidecar; retake and replay reproduce it', async (t) => {
  const { chromium } = await import('playwright');
  if (!existsSync(chromium.executablePath())) return t.skip('npx playwright install chromium');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'shot-term-'));
  const out = path.join(dir, 'a.png');

  const s = await captureTerminal({ output: out, width: 640, scale: 1, cols: 40, show: 'demo', command: ['printf', '\\033[31mred\\033[0m\\n%050d\\n', '7'] });
  assert.deepEqual(size(out), [640, 360]);
  assert.equal(readFileSync(path.join(dir, 'a.ansi'), 'utf8'), `\x1b[31mred\x1b[0m\r\n${'7'.padStart(50, '0')}\r\n`);
  const { terminal } = s;
  assert.equal(terminal.shown, 'demo');
  assert.equal(terminal.exitCode, 0);
  assert.equal(terminal.cols, 40);
  assert.equal(terminal.wrapped, 1, 'fifty digits in forty columns');
  assert.equal(terminal.lines, 4, 'the prompt, red, and the digits over two rows');
  assert.equal(terminal.scrolledOff, 0);
  assert.equal(s.url, undefined);
  assert.deepEqual(JSON.parse(readFileSync(sidecarPath(out), 'utf8')), s);

  const again = await retake(sidecarPath(out));
  assert.deepEqual({ ...again, capturedAt: 0 }, { ...s, capturedAt: 0 });

  // From the recording alone, as a series does for a server it has since stopped.
  const replayed = await captureTerminal({ output: path.join(dir, 'b.png'), width: 640, scale: 1, cols: 40, show: 'demo', replay: path.join(dir, 'a.ansi') });
  assert.equal(replayed.terminal.command, null);
  assert.deepEqual([replayed.terminal.lines, replayed.terminal.wrapped], [4, 1]);
  assert.deepEqual(readFileSync(path.join(dir, 'b.png')), readFileSync(out));
  assert.equal((await retake(path.join(dir, 'b.json'))).terminal.recording, 'b.ansi');

  // More than the frame holds: the end is shown, and the sidecar says what is not.
  const long = await captureTerminal({ output: out, width: 640, scale: 1, cols: 40, command: ['seq', '1', '200'] });
  assert.equal(long.terminal.lines, 201);
  assert.equal(long.terminal.scrolledOff, 201 - long.terminal.rows);
});
