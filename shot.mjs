#!/usr/bin/env node
// shot: a chrome-free screenshot of a URL at a fixed aspect ratio, with a JSON
// sidecar beside it saying how it was made, so it can be cited and retaken.
//
//   shot <url> -o out/name.png [options]
//   shot term -o out/name.png [options] -- <command>...   (term.mjs)
//   shot index <dir>, shot sheet <dir> -o sheet.png        (sheet.mjs)
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
 * The part every kind of shot shares: a page of the frame's size, the image
 * with its caption strip, and the sidecar. `draw(page, viewport)` puts on the
 * page whatever is to be photographed and answers
 * `{ about, options, captionText }`: `about` is what the sidecar says the
 * picture is of, `options` what it would take to draw it again.
 *
 * opts: output (.png), ratio, width, scale, browser, repo (git working tree of
 * the software on screen), meta (object), caption, colorScheme ("dark" or
 * "light": what the page's prefers-color-scheme is answered with).
 */
export async function takeFrame(opts, draw) {
  const {
    output, ratio = '16:9', width = 1280, scale = 2, browser: engine = 'chromium', repo = null, meta = {}, caption = null,
    colorScheme = null,
  } = opts;
  if (!output || !/\.png$/i.test(output)) throw new Error('-o wants a path ending in .png');
  if (colorScheme && !['dark', 'light'].includes(colorScheme)) throw new Error(`--color-scheme ${colorScheme}: want dark or light`);
  const frame = viewportFor(ratio, width);
  // The caption strip comes out of the page's height, so the image is still `ratio`.
  const viewport = caption ? { ...frame, height: frame.height - CAPTION_HEIGHT } : frame;

  const browser = await launch(engine);
  try {
    // Unset, a page is told light: Playwright's default, whatever this machine is set to.
    const page = await browser.newPage({ viewport, deviceScaleFactor: scale, ...(colorScheme && { colorScheme }) });
    mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    const { about, options, captionText = caption } = await draw(page, viewport);

    if (!caption) {
      await page.screenshot({ path: output });
    } else {
      const shot = await page.screenshot();
      const framed = await browser.newPage({ viewport: frame, deviceScaleFactor: scale });
      await framed.setContent(`<body style="margin:0;background:#fff">
        <img style="display:block;width:${viewport.width}px;height:${viewport.height}px" src="data:image/png;base64,${shot.toString('base64')}">
        <div style="height:${CAPTION_HEIGHT}px;padding:0 10px;box-sizing:border-box;
          font:13px/${CAPTION_HEIGHT - 1}px ui-monospace,Menlo,monospace;color:#333;background:#f2f2f2;border-top:1px solid #ccc;
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(captionText)}</div></body>`);
      await framed.screenshot({ path: output });
    }

    const { default: pw } = await import('playwright/package.json', { with: { type: 'json' } });
    const sidecar = {
      image: path.basename(output),
      capturedAt: new Date().toISOString(),
      ...about,
      ratio, viewport, scale,
      pixels: { width: frame.width * scale, height: frame.height * scale },
      browser: { name: engine, version: browser.version() },
      playwright: pw.version,
      options,
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

/**
 * Draw a ring around the first thing `selector` matches, over the page and
 * outside its layout. Nothing to ring is an error: across the versions of a
 * tool a selector stops matching, and a frame that silently lost its ring
 * reads as a frame that never had one.
 */
async function ring(page, selector) {
  const target = page.locator(selector).first();
  const box = (await target.count()) ? await target.boundingBox() : null;
  if (!box) throw new Error(`--highlight ${JSON.stringify(selector)}: nothing visible on the page matches`);
  await page.evaluate(({ x, y, width, height }) => {
    const gap = 5, line = 3;
    const el = document.createElement('div');
    // Red with a white edge either side, so it shows on a dark page and a light one.
    el.style.cssText = `position:fixed;z-index:2147483647;pointer-events:none;box-sizing:border-box;
      left:${x - gap - line}px;top:${y - gap - line}px;width:${width + 2 * (gap + line)}px;height:${height + 2 * (gap + line)}px;
      border:${line}px solid #e5484d;border-radius:8px;box-shadow:0 0 0 1.5px #fff, inset 0 0 0 1.5px #fff`;
    document.documentElement.append(el);
  }, box);
}

/**
 * Take one screenshot of a URL and write its sidecar. Answers the sidecar's contents.
 *
 * opts: what takeFrame takes, and url, waitFor, delay, setup (path to a module
 * whose default export is `async (page) => {}`), highlight (selectors to ring),
 * caption (text, or "url" for the page's URL).
 */
export async function capture(opts) {
  const { url, waitFor = null, delay = 0, setup = null, highlight = [], caption = null, colorScheme = null } = opts;
  if (!url) throw new Error('no URL given');
  return takeFrame(opts, async (page) => {
    await page.goto(url, { waitUntil: 'load' });
    if (waitFor) await page.locator(waitFor).first().waitFor({ state: 'visible' });
    if (setup) await (await import(pathToFileURL(path.resolve(setup)).href)).default(page);
    if (delay) await page.waitForTimeout(delay);
    // Last, on the page as it will be photographed: a ring is placed, not attached.
    for (const selector of highlight) await ring(page, selector);
    const finalUrl = page.url();
    return {
      about: { url, finalUrl, pageTitle: await page.title() },
      options: { waitFor, delay, setup: setup && path.resolve(setup), caption, colorScheme, highlight },
      captionText: caption === 'url' ? finalUrl : caption,
    };
  });
}

/** Take a shot again from what its sidecar recorded, replacing both files. */
export async function retake(sidecarFile) {
  const s = JSON.parse(readFileSync(sidecarFile, 'utf8'));
  const dir = path.dirname(sidecarFile);
  const shared = {
    output: path.join(dir, s.image),
    ratio: s.ratio,
    // With a caption the recorded viewport is shorter than the frame; its width is not.
    width: s.viewport.width,
    scale: s.scale,
    browser: s.browser.name,
    ...s.options,
    repo: s.subject?.path ?? null,
    meta: s.meta,
  };
  if (s.terminal) return (await import('./term.mjs')).retakeTerminal(shared, s.terminal, dir);
  if (s.sheet) return (await import('./sheet.mjs')).captureSheet({ ...shared, ...s.sheet });
  return capture({ url: s.url, ...shared });
}

// The options every kind of shot takes, for parseArgs, and what takeFrame wants of them.
export const FRAME_OPTIONS = {
  output: { type: 'string', short: 'o' },
  ratio: { type: 'string', default: '16:9' },
  width: { type: 'string', default: '1280' },
  scale: { type: 'string', default: '2' },
  browser: { type: 'string', default: 'chromium' },
  repo: { type: 'string' },
  meta: { type: 'string', multiple: true },
  caption: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
};
export const frameOptions = (v) => ({
  output: v.output, ratio: v.ratio, width: Number(v.width), scale: Number(v.scale), browser: v.browser,
  repo: v.repo ?? null, meta: parseMeta(v.meta), caption: v.caption ?? null,
});

export const USAGE = `shot <url> -o <name.png> [--ratio 16:9] [--width 1280] [--scale 2] [--browser chromium|firefox]
     [--wait-for <css>] [--delay <ms>] [--setup <file.mjs>] [--color-scheme dark|light] [--highlight <css>]...
     [--repo <path>] [--meta key=value]... [--caption <text>|url]
shot term -o <name.png> [--cols 100] [--theme dark|light] [--show <text>] [--no-prompt] [--scroll bottom|top]
     [--cwd <dir>] [--env KEY=value]... [--until <regex>] [--timeout <ms>] [--replay <file.ansi>]
     [--ratio --width --scale --browser --repo --meta --caption, as above] -- <command>...
shot index <dir> [--title <text>] [--intro <text>] [--column 'Heading=template']...
shot sheet <dir> -o <sheet.png> [--columns <n>] [--label <template>] [--title <text>] [--theme light|dark]
     [--ratio --width --scale --browser --meta --caption, as above]
shot retake <sidecar.json>...`;

async function main(argv) {
  if (argv[0] === 'term') return (await import('./term.mjs')).main(argv.slice(1));
  if (argv[0] === 'index' || argv[0] === 'sheet') return (await import('./sheet.mjs')).main(argv);
  const { values: v, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      ...FRAME_OPTIONS,
      'wait-for': { type: 'string' },
      delay: { type: 'string', default: '0' },
      setup: { type: 'string' },
      'color-scheme': { type: 'string' },
      highlight: { type: 'string', multiple: true },
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
    url: positionals[0], ...frameOptions(v),
    waitFor: v['wait-for'] ?? null, delay: Number(v.delay), setup: v.setup ?? null,
    colorScheme: v['color-scheme'] ?? null, highlight: v.highlight ?? [],
  });
  console.log(`${v.output}  ${s.pixels.width}x${s.pixels.height}  ${s.browser.name} ${s.browser.version}`);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((e) => { console.error(`shot: ${e.message}`); process.exit(1); });
}
