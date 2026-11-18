#!/usr/bin/env node
// shot: a chrome-free screenshot of a URL at a fixed aspect ratio, with a JSON
// sidecar beside it saying how it was made, so it can be cited and retaken.
//
//   shot <url> -o out/name.png [options]
//   shot retake <sidecar.json>...
//
// README.md has the options and the sidecar's fields.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const CAPTION_HEIGHT = 28; // CSS px, taken out of the page's height so the image keeps its ratio

/** "16:9", 1280 -> { width: 1280, height: 720 }. */
export function viewportFor(ratio, width) {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(ratio);
  if (!m || !+m[1] || !+m[2]) throw new Error(`--ratio ${JSON.stringify(ratio)}: want W:H, like 16:9`);
  if (!Number.isInteger(width) || width <= 0) throw new Error(`--width ${width}: want a whole number of CSS pixels`);
  return { width, height: Math.round((width * m[2]) / m[1]) };
}

/** out/name.png -> out/name.json */
export const sidecarPath = (png) => png.replace(/\.png$/i, '') + '.json';

/** ["pr=203", "title=a=b"] -> { pr: "203", title: "a=b" } */
export function parseMeta(pairs = []) {
  return Object.fromEntries(pairs.map((p) => {
    const i = p.indexOf('=');
    if (i < 1) throw new Error(`--meta ${JSON.stringify(p)}: want key=value`);
    return [p.slice(0, i), p.slice(i + 1)];
  }));
}

const git = (dir, ...args) => {
  try {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return null; }
};

/** What is checked out at `dir`, or null when it is not a git working tree. */
export function gitInfo(dir) {
  const commit = git(dir, 'rev-parse', 'HEAD');
  if (!commit) return null;
  return {
    path: path.resolve(dir),
    repo: git(dir, 'remote', 'get-url', 'origin'),
    commit,
    commitDate: git(dir, 'show', '-s', '--format=%cI', 'HEAD'),
    branch: git(dir, 'branch', '--show-current') || null,
    dirty: git(dir, 'status', '--porcelain') !== '',
  };
}

async function launch(name) {
  const engines = await import('playwright');
  if (!['chromium', 'firefox'].includes(name)) throw new Error(`--browser ${name}: want chromium or firefox`);
  // macOS 27 denies a terminal-launched Firefox its own Application Support
  // directory, and it then hangs until Playwright's timeout with nothing to say
  // why. Giving it somewhere else to keep app data is the workaround prcoder's
  // tools/driver.mjs found (its issue #80); Firefox 158 fixes it upstream.
  // Harmless elsewhere.
  let env;
  if (name === 'firefox') {
    const appData = path.join(os.tmpdir(), 'software-screenshots-firefox');
    env = { ...process.env, MOZ_APP_DATA: path.join(appData, 'roaming'), MOZ_LOCAL_APP_DATA: path.join(appData, 'local') };
    for (const d of [env.MOZ_APP_DATA, env.MOZ_LOCAL_APP_DATA]) mkdirSync(d, { recursive: true });
  }
  return engines[name].launch(env ? { env } : {});
}

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Take one screenshot and write its sidecar. Answers the sidecar's contents.
 *
 * opts: url, output (.png), ratio, width, scale, browser, waitFor, delay,
 * setup (path to a module whose default export is `async (page) => {}`),
 * repo (git working tree of the software on screen), meta (object),
 * caption (text, or "url" for the page's URL).
 */
export async function capture(opts) {
  const {
    url, output, ratio = '16:9', width = 1280, scale = 2, browser: engine = 'chromium',
    waitFor = null, delay = 0, setup = null, repo = null, meta = {}, caption = null,
  } = opts;
  if (!url) throw new Error('no URL given');
  if (!output || !/\.png$/i.test(output)) throw new Error('-o wants a path ending in .png');
  const frame = viewportFor(ratio, width);
  // The caption strip comes out of the page's height, so the image is still `ratio`.
  const viewport = caption ? { ...frame, height: frame.height - CAPTION_HEIGHT } : frame;

  const browser = await launch(engine);
  try {
    const page = await browser.newPage({ viewport, deviceScaleFactor: scale });
    await page.goto(url, { waitUntil: 'load' });
    if (waitFor) await page.locator(waitFor).first().waitFor({ state: 'visible' });
    if (setup) await (await import(pathToFileURL(path.resolve(setup)).href)).default(page);
    if (delay) await page.waitForTimeout(delay);
    const finalUrl = page.url();
    const pageTitle = await page.title();

    mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    if (!caption) {
      await page.screenshot({ path: output });
    } else {
      const shot = await page.screenshot();
      const text = caption === 'url' ? finalUrl : caption;
      const framed = await browser.newPage({ viewport: frame, deviceScaleFactor: scale });
      await framed.setContent(`<body style="margin:0;background:#fff">
        <img style="display:block;width:${viewport.width}px;height:${viewport.height}px" src="data:image/png;base64,${shot.toString('base64')}">
        <div style="height:${CAPTION_HEIGHT}px;padding:0 10px;box-sizing:border-box;
          font:13px/${CAPTION_HEIGHT - 1}px ui-monospace,Menlo,monospace;color:#333;background:#f2f2f2;border-top:1px solid #ccc;
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(text)}</div></body>`);
      await framed.screenshot({ path: output });
    }

    const { default: pw } = await import('playwright/package.json', { with: { type: 'json' } });
    const sidecar = {
      image: path.basename(output),
      capturedAt: new Date().toISOString(),
      url, finalUrl, pageTitle,
      ratio, viewport, scale,
      pixels: { width: frame.width * scale, height: frame.height * scale },
      browser: { name: engine, version: browser.version() },
      playwright: pw.version,
      options: { waitFor, delay, setup: setup && path.resolve(setup), caption },
      subject: repo && gitInfo(repo),
      meta,
      tool: { name: 'software-screenshots', commit: git(here, 'rev-parse', 'HEAD') },
    };
    writeFileSync(sidecarPath(output), JSON.stringify(sidecar, null, 2) + '\n');
    return sidecar;
  } finally {
    await browser.close();
  }
}

/** Take a shot again from what its sidecar recorded, replacing both files. */
export async function retake(sidecarFile) {
  const s = JSON.parse(readFileSync(sidecarFile, 'utf8'));
  return capture({
    url: s.url,
    output: path.join(path.dirname(sidecarFile), s.image),
    ratio: s.ratio,
    // With a caption the recorded viewport is shorter than the frame; its width is not.
    width: s.viewport.width,
    scale: s.scale,
    browser: s.browser.name,
    ...s.options,
    repo: s.subject?.path ?? null,
    meta: s.meta,
  });
}

const USAGE = `shot <url> -o <name.png> [--ratio 16:9] [--width 1280] [--scale 2] [--browser chromium|firefox]
     [--wait-for <css>] [--delay <ms>] [--setup <file.mjs>] [--repo <path>] [--meta key=value]... [--caption <text>|url]
shot retake <sidecar.json>...`;

async function main(argv) {
  const { values: v, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      output: { type: 'string', short: 'o' },
      ratio: { type: 'string', default: '16:9' },
      width: { type: 'string', default: '1280' },
      scale: { type: 'string', default: '2' },
      browser: { type: 'string', default: 'chromium' },
      'wait-for': { type: 'string' },
      delay: { type: 'string', default: '0' },
      setup: { type: 'string' },
      repo: { type: 'string' },
      meta: { type: 'string', multiple: true },
      caption: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (v.help || !positionals.length) return console.log(USAGE);
  if (positionals[0] === 'retake') {
    for (const f of positionals.slice(1)) {
      const s = await retake(f);
      console.log(`${path.join(path.dirname(f), s.image)}  ${s.pixels.width}x${s.pixels.height}  ${s.browser.name}`);
    }
    return;
  }
  if (positionals.length > 1) throw new Error(`one URL at a time, got ${positionals.length}`);
  const s = await capture({
    url: positionals[0], output: v.output, ratio: v.ratio, width: Number(v.width), scale: Number(v.scale),
    browser: v.browser, waitFor: v['wait-for'] ?? null, delay: Number(v.delay), setup: v.setup ?? null,
    repo: v.repo ?? null, meta: parseMeta(v.meta), caption: v.caption ?? null,
  });
  console.log(`${v.output}  ${s.pixels.width}x${s.pixels.height}  ${s.browser.name} ${s.browser.version}`);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((e) => { console.error(`shot: ${e.message}`); process.exit(1); });
}
