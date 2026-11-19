// shot term: a frame of a command's terminal output. The command runs in a
// pseudo-terminal, so a tool that colours only for a terminal colours here, and
// its bytes are drawn by xterm.js in the same headless page, ratio and sidecar
// a URL's shot gets.
//
//   shot term -o out/name.png [options] -- <command>...
//   shot term -o out/name.png --replay <file.ansi>
//
// README.md has the options.

import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { FRAME_OPTIONS, frameOptions, parseMeta, takeFrame, USAGE } from './shot.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAD = 16; // CSS px between the frame's edge and the text
const FONT = 'Menlo, "DejaVu Sans Mono", "Liberation Mono", monospace';
const THEMES = {
  dark: { background: '#16181d', foreground: '#d7dae0' },
  light: {
    background: '#ffffff', foreground: '#24292f',
    // xterm's own sixteen are picked for a dark ground; yellow and white vanish on this one.
    black: '#24292f', red: '#cf222e', green: '#116329', yellow: '#7d4e00', blue: '#0969da', magenta: '#8250df', cyan: '#1b7c83', white: '#6e7781',
    brightBlack: '#57606a', brightRed: '#a40e26', brightGreen: '#1a7f37', brightYellow: '#633c01', brightBlue: '#218bff', brightMagenta: '#a475f9', brightCyan: '#3192aa', brightWhite: '#8c959f',
  },
};

/** Output with its escape sequences taken out, for matching text a tool has coloured. */
export const plain = (s) => s.replace(/\x1b\[[0-?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g, '');

/**
 * Start a command in a pseudo-terminal and keep what it writes.
 *
 * Answers { pid, output() (a Buffer of everything so far), waitFor(regex, ms)
 * (resolves with the match once the output, less its escape sequences, has
 * one), exited (a promise of { exitCode, signal }), kill() }.
 */
export async function spawnPty(argv, { cols = 100, rows = 30, cwd = process.cwd(), env = process.env } = {}) {
  const { default: pty } = await import('node-pty');
  // encoding null: bytes, so a character split across two reads is not mangled.
  const child = pty.spawn(argv[0], argv.slice(1), { name: 'xterm-256color', cols, rows, cwd, env, encoding: null });
  const chunks = [];
  const watchers = new Set();
  let exit = null;
  child.onData((d) => { chunks.push(Buffer.from(d)); for (const w of [...watchers]) w(); });
  const exited = new Promise((resolve) => child.onExit((e) => { exit = e; for (const w of [...watchers]) w(); resolve(e); }));
  const output = () => Buffer.concat(chunks);
  const waitFor = (regex, ms = 30_000) => new Promise((resolve, reject) => {
    const settle = (fn, value) => { clearTimeout(timer); watchers.delete(look); fn(value); };
    const look = () => {
      const m = regex.exec(plain(output().toString('utf8')));
      if (m) settle(resolve, m);
      else if (exit) settle(reject, new Error(`${argv[0]} exited (${exit.exitCode}) before its output matched ${regex}`));
    };
    const timer = setTimeout(() => settle(reject, new Error(`${argv[0]}: nothing matching ${regex} in ${ms}ms of output`)), ms);
    watchers.add(look);
    look();
  });
  // The whole group: the command is its session's leader, and what it started goes with it.
  const kill = () => { try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill(); } catch {} } };
  return { pid: child.pid, output, waitFor, exited, kill };
}

/**
 * Run a command in a pseudo-terminal to its end and answer { data, exitCode }.
 * With `until`, it is stopped once its output matches, and `timeout` is how
 * long that may take; with `timeout` alone, it is stopped after that long.
 * A stopped command has no exit code.
 */
export async function record(argv, { until = null, timeout = null, ...size } = {}) {
  const child = await spawnPty(argv, size);
  let exitCode = null;
  try {
    if (until) {
      await child.waitFor(until, timeout ?? 30_000);
      await sleep(250); // the rest of the line it matched in
    } else {
      const done = await Promise.race([child.exited, ...(timeout ? [sleep(timeout)] : [])]);
      if (done) exitCode = done.exitCode;
    }
  } finally {
    child.kill();
  }
  await sleep(50); // the last read can land after the exit
  return { data: child.output(), exitCode };
}

const require = createRequire(import.meta.url);
const xtermJs = require.resolve('@xterm/xterm');
const xtermCss = path.join(path.dirname(xtermJs), '..', 'css', 'xterm.css');

/**
 * Put an empty terminal of `cols` columns on the page, its font sized so that
 * they fill the width. Answers { rows, fontSize }: the rows that fit below.
 */
async function openTerminal(page, viewport, { cols, theme, font }) {
  await page.setContent(`<!doctype html><body style="margin:0;background:${THEMES[theme].background}"><div id="t" style="padding:${PAD}px"></div></body>`);
  await page.addStyleTag({ path: xtermCss });
  // xterm draws a scrollbar, and a shadow under the top edge, once anything has scrolled off.
  await page.addStyleTag({ content: '.xterm .xterm-scrollable-element > :is(.scrollbar, .shadow) { display: none !important }' });
  await page.addScriptTag({ path: xtermJs });
  return page.evaluate(({ cols, colors, font, width, height }) => {
    const term = new Terminal({
      cols, rows: 10, fontFamily: font, fontSize: 16, theme: colors, scrollback: 100_000,
      cursorInactiveStyle: 'none', // the command is over; nothing is waiting for input
    });
    term.open(document.getElementById('t'));
    const screen = document.querySelector('.xterm-screen');
    const box = () => screen.getBoundingClientRect();
    // xterm snaps a cell to whole device pixels, so the size that makes `cols`
    // fit is found by trying: the proportional guess, then down until it does.
    let fontSize = Math.floor((16 * width / box().width) * 4) / 4;
    term.options.fontSize = fontSize;
    while (box().width > width && fontSize > 4) term.options.fontSize = (fontSize -= 0.25);
    const rows = Math.max(1, Math.floor(height / (box().height / term.rows)));
    term.resize(cols, rows);
    window.term = term;
    return { rows, fontSize };
  }, { cols, colors: THEMES[theme], font, width: viewport.width - 2 * PAD, height: viewport.height - 2 * PAD });
}

const write = (page, bytes) => page.evaluate(
  (b64) => new Promise((done) => window.term.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), done)),
  Buffer.from(bytes).toString('base64'));

/**
 * Take one frame of a command's terminal output and write its sidecar.
 *
 * opts: what takeFrame takes, and command (argv) or replay (a file of recorded
 * bytes), cols, theme, font, show (the command as the prompt line gives it),
 * prompt (null for no prompt line), scroll ("bottom" or "top"), cwd, env
 * (variables over this process's), until (RegExp), timeout (ms).
 */
export async function captureTerminal(opts) {
  const {
    output, command = null, replay = null, cols = 100, theme = 'dark', font = FONT, show = null, prompt = '$ ',
    scroll = 'bottom', cwd = process.cwd(), env = {}, until = null, timeout = null, caption = null,
  } = opts;
  if (!command?.length === !replay) throw new Error('want a command after --, or --replay <file.ansi>, and not both');
  if (!THEMES[theme]) throw new Error(`--theme ${theme}: want dark or light`);
  if (!['bottom', 'top'].includes(scroll)) throw new Error(`--scroll ${scroll}: want bottom or top`);
  if (!Number.isInteger(cols) || cols < 1) throw new Error(`--cols ${cols}: want a whole number of columns`);

  return takeFrame(opts, async (page, viewport) => {
    // Before the command runs, so that it runs in a terminal of the size drawn.
    const { rows, fontSize } = await openTerminal(page, viewport, { cols, theme, font });
    let data, exitCode = null;
    if (replay) data = readFileSync(replay);
    else ({ data, exitCode } = await record(command, { cols, rows, cwd, env: { ...process.env, ...env }, until, timeout }));

    // The bytes stay beside the image: the frame can be drawn again from them
    // when the command no longer can be run.
    const recording = output.replace(/\.png$/i, '') + '.ansi';
    if (!replay) writeFileSync(recording, data);
    else if (path.resolve(replay) !== path.resolve(recording)) copyFileSync(replay, recording);

    const shown = show ?? command?.join(' ') ?? null;
    if (prompt !== null && shown) await write(page, `\x1b[2m${prompt}\x1b[0m${shown}\r\n`);
    // Less the last newline, which would spend the frame's last row on the cursor's empty line.
    await write(page, data.subarray(0, data.length - (data.at(-1) === 0x0a ? (data.at(-2) === 0x0d ? 2 : 1) : 0)));
    const seen = await page.evaluate((scroll) => {
      const b = window.term.buffer.active;
      let wrapped = 0;
      for (let i = 0; i < b.length; i++) if (b.getLine(i)?.isWrapped) wrapped++;
      if (scroll === 'top') window.term.scrollToTop();
      const lines = b.baseY + b.cursorY + 1;
      // Two frames: xterm draws on the next one.
      return new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done({ lines, wrapped, scrolledOff: b.baseY }))));
    }, scroll);

    return {
      about: {
        terminal: {
          command, shown, cwd: command ? path.resolve(cwd) : null, env, exitCode,
          recording: path.basename(recording),
          cols, rows, fontSize, font, theme, prompt, scroll,
          until: until?.source ?? null, timeout,
          ...seen,
        },
      },
      options: { caption },
    };
  });
}

/** shot retake, for a terminal's sidecar: the command again, or its recording when it had none. */
export function retakeTerminal(shared, t, dir) {
  return captureTerminal({
    ...shared, cols: t.cols, theme: t.theme, font: t.font, show: t.shown, prompt: t.prompt, scroll: t.scroll,
    ...(t.command
      ? { command: t.command, cwd: t.cwd, env: t.env, until: t.until && new RegExp(t.until), timeout: t.timeout }
      : { replay: path.join(dir, t.recording) }),
  });
}

export async function main(argv) {
  const { values: v, positionals: command } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      ...FRAME_OPTIONS,
      cols: { type: 'string', default: '100' },
      theme: { type: 'string', default: 'dark' },
      font: { type: 'string' },
      show: { type: 'string' },
      'no-prompt': { type: 'boolean' },
      scroll: { type: 'string', default: 'bottom' },
      cwd: { type: 'string' },
      env: { type: 'string', multiple: true },
      until: { type: 'string' },
      timeout: { type: 'string' },
      replay: { type: 'string' },
    },
  });
  if (v.help) return console.log(USAGE);
  const s = await captureTerminal({
    ...frameOptions(v), command: command.length ? command : null, replay: v.replay ?? null,
    cols: Number(v.cols), theme: v.theme, ...(v.font && { font: v.font }), show: v.show ?? null,
    ...(v['no-prompt'] && { prompt: null }), scroll: v.scroll, ...(v.cwd && { cwd: v.cwd }), env: parseMeta(v.env),
    until: v.until ? new RegExp(v.until) : null, timeout: v.timeout ? Number(v.timeout) : null,
  });
  const t = s.terminal;
  if (t.wrapped) console.error(`shot term: ${t.wrapped} line(s) wrapped at ${t.cols} columns; raise --cols`);
  if (t.scrolledOff) {
    console.error(`shot term: ${t.lines} lines in ${t.rows} rows, ${t.scrolledOff} of them ${t.scroll === 'top' ? 'below the frame' : 'scrolled off the top; --scroll top shows the start'}`);
  }
  console.log(`${v.output}  ${s.pixels.width}x${s.pixels.height}  ${t.cols}x${t.rows} cells${t.exitCode === null ? '' : `  exit ${t.exitCode}`}`);
}
