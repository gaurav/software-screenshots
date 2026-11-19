// shot index and shot sheet: what is made from a directory of frames once they
// are taken. Both read the sidecars, so neither needs the software that was on
// screen to still be running.
//
//   shot index <dir> [--title <text>] [--intro <text>] [--column 'Heading=template']...
//   shot sheet <dir> -o sheet.png [--columns <n>] [--label <template>] [--title <text>] [--theme dark|light]
//
// README.md has the template's keys.

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { FRAME_OPTIONS, frameOptions, takeFrame, USAGE, viewportFor } from './shot.mjs';

/**
 * The frames in a directory, in the order of their file names: each sidecar's
 * contents. A sheet's own sidecar is not a frame.
 */
export function readFrames(dir) {
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    .map((f) => { try { return JSON.parse(readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } })
    .filter((s) => s?.image && s.pixels && !s.sheet);
}

/**
 * "{date} #{pr}" filled in from a frame's sidecar. The keys are image, name
 * (the image less .png), commit (eight characters), date (the commit's, or the
 * capture's without --repo), url, title, command, and then its meta's, which
 * win: a series that dates its frames another way says so with --meta date=.
 * One that the frame does not have is empty.
 */
export function fill(template, s) {
  const known = {
    image: s.image,
    name: s.image.replace(/\.png$/i, ''),
    commit: s.subject?.commit?.slice(0, 8),
    date: (s.subject?.commitDate ?? s.capturedAt).slice(0, 10),
    url: s.finalUrl,
    title: s.pageTitle,
    command: s.terminal?.shown,
    ...s.meta,
  };
  return template.replace(/\{(\w+)\}/g, (_, key) => known[key] ?? '');
}

/** ["PR=#{pr}"] -> [["PR", "#{pr}"]] */
const parseColumns = (pairs) => pairs.map((p) => {
  const i = p.indexOf('=');
  if (i < 1) throw new Error(`--column ${JSON.stringify(p)}: want Heading=template`);
  return [p.slice(0, i), p.slice(i + 1)];
});

/**
 * Write <dir>/README.md, a table of the directory's frames. Without columns:
 * File, Commit when any frame has one, and a column per meta key.
 */
export function writeIndex(dir, { title = path.basename(path.resolve(dir)), intro = null, columns = [] } = {}) {
  const frames = readFrames(dir);
  if (!columns.length) {
    columns = [['File', '{image}'], ...(frames.some((s) => s.subject) ? [['Commit', '{commit}']] : []),
      ...[...new Set(frames.flatMap((s) => Object.keys(s.meta ?? {})))].map((k) => [k, `{${k}}`])];
  }
  const cell = (text) => text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
  const row = (cells) => `| ${cells.join(' | ')} |`;
  const file = path.join(dir, 'README.md');
  writeFileSync(file, [
    `# ${title}`, '', ...(intro ? [intro, ''] : []),
    row(columns.map(([heading]) => heading)), row(columns.map(() => '---')),
    ...frames.map((s) => row(columns.map(([, template]) => cell(fill(template, s))))), '',
  ].join('\n'));
  return { file, frames: frames.length };
}

const LABEL = 22; // CSS px under each thumbnail
const GAP = 12;
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** How wide each of `n` thumbnails of `shape` (width over height) is, `c` to a row, in a w x h box. */
const thumbWidth = (n, c, shape, w, h) => {
  const rows = Math.ceil(n / c);
  return Math.floor(Math.min((w - GAP * (c - 1)) / c, ((h - GAP * (rows - 1)) / rows - LABEL) * shape));
};

/** The number of columns that makes them largest. */
export function bestColumns(n, shape, w, h) {
  let best = 1;
  for (let c = 2; c <= n; c++) if (thumbWidth(n, c, shape, w, h) > thumbWidth(n, best, shape, w, h)) best = c;
  return best;
}

/**
 * One image of every frame in a directory: a grid in file-name order, each
 * frame labelled from its sidecar. Answers the sheet's sidecar.
 *
 * opts: what takeFrame takes, and dir, columns (a number; the largest
 * thumbnails by default), label (a template for fill), title, theme.
 */
export async function captureSheet(opts) {
  const { dir, output, columns = null, label = '{name}', title = null, theme = 'light', ratio = '16:9', width = 1280, caption = null } = opts;
  if (!['dark', 'light'].includes(theme)) throw new Error(`--theme ${theme}: want dark or light`);
  // A sheet kept in the directory it is of does not go on its next retake.
  const frames = readFrames(dir).filter((s) => path.resolve(dir, s.image) !== path.resolve(output));
  if (!frames.length) throw new Error(`${dir}: no frames (a .png with its .json sidecar) to make a sheet of`);

  const page = viewportFor(ratio, width);
  const titleHeight = title ? 44 : 0;
  // Every thumbnail is the first frame's shape; a frame of another is fitted inside it.
  const shape = frames[0].pixels.width / frames[0].pixels.height;
  const box = [page.width - 2 * GAP, page.height - (caption ? 28 : 0) - 2 * GAP - titleHeight];
  const cols = columns ?? bestColumns(frames.length, shape, ...box);
  const thumb = thumbWidth(frames.length, cols, shape, ...box);
  if (thumb < 16) throw new Error(`--columns ${cols}: ${frames.length} frames do not fit; try fewer columns or a larger --width`);
  const [ground, ink, edge] = theme === 'dark' ? ['#16181d', '#d7dae0', '#3a3f4b'] : ['#ffffff', '#24292f', '#d0d7de'];
  const html = `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; height: 100vh; box-sizing: border-box; padding: ${GAP}px; display: flex; flex-direction: column;
      background: ${ground}; color: ${ink}; font: 13px/${LABEL}px ui-monospace, Menlo, monospace; }
    h1 { margin: 0; height: ${titleHeight}px; font: 600 22px/${titleHeight - GAP}px system-ui, sans-serif; flex: none; }
    main { flex: 1; display: grid; gap: ${GAP}px; grid-template-columns: repeat(${cols}, ${thumb}px); place-content: center; }
    figure { margin: 0; }
    img { display: block; width: ${thumb}px; height: ${Math.floor(thumb / shape)}px; object-fit: contain; outline: 1px solid ${edge}; }
    figcaption { height: ${LABEL}px; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  </style>${title ? `<h1>${escapeHtml(title)}</h1>` : ''}<main>${frames.map((s) => `
    <figure><img src="${pathToFileURL(path.resolve(dir, s.image)).href}"><figcaption>${escapeHtml(fill(label, s))}</figcaption></figure>`).join('')}
  </main>`;

  // A file, not setContent: a page with no address of its own may not load file: images.
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'shot-sheet-'));
  try {
    writeFileSync(path.join(tmp, 'sheet.html'), html);
    return await takeFrame(opts, async (pg) => {
      await pg.goto(pathToFileURL(path.join(tmp, 'sheet.html')).href, { waitUntil: 'load' });
      return {
        about: { sheet: { dir: path.resolve(dir), frames: frames.map((s) => s.image), columns, label, title, theme } },
        options: { caption },
      };
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export async function main(argv) {
  const { values: v, positionals: [verb, dir, ...extra] } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      ...FRAME_OPTIONS,
      title: { type: 'string' },
      intro: { type: 'string' },
      column: { type: 'string', multiple: true },
      columns: { type: 'string' },
      label: { type: 'string' },
      theme: { type: 'string', default: 'light' },
    },
  });
  if (v.help) return console.log(USAGE);
  if (!dir || extra.length) throw new Error(`shot ${verb} wants one directory of frames`);
  if (verb === 'index') {
    const { file, frames } = writeIndex(dir, { ...(v.title && { title: v.title }), intro: v.intro ?? null, columns: parseColumns(v.column ?? []) });
    return console.log(`${file}  ${frames} frames`);
  }
  const s = await captureSheet({
    ...frameOptions(v), dir, columns: v.columns ? Number(v.columns) : null,
    ...(v.label && { label: v.label }), title: v.title ?? null, theme: v.theme,
  });
  console.log(`${v.output}  ${s.pixels.width}x${s.pixels.height}  ${s.sheet.frames.length} frames`);
}
