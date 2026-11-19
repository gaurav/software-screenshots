#!/usr/bin/env node
// milestones from a table in a terminal to a board in a browser: one or more
// frames per step, each taken from that step's own code. README.md beside this
// says what it needs and what it leaves behind.
//
//   node examples/milestones-evolution/series.mjs          # every frame in FRAMES
//   node examples/milestones-evolution/series.mjs 5 11     # only the 5th and 11th
//
// Everything it makes is under data/, which is git-ignored.
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { capture } from '../../shot.mjs';
import { captureSheet, writeIndex } from '../../sheet.mjs';
import { captureTerminal, spawnPty } from '../../term.mjs';

const here = import.meta.dirname;
const data = path.join(here, '..', '..', 'data');
const clone = path.join(data, 'milestones');
const out = path.join(data, 'milestones-evolution');
const scratch = path.join(data, 'milestones-run'); // the config, each frame's state, the gh that only reads
const REPO = 'https://github.com/gaurav/milestones';

// What every version is pointed at, in place of ~/.config/milestones.toml.
const TRACKED = ['gaurav/milestones', 'NCATSTranslator/Babel'];
const BUCKETS = ['Critical', 'Needed soon', 'Needed later', 'Not urgent', 'Upstream', 'Needs triage'];
// The board the board frames show: the tool's own.
const BOARD = 'gaurav/milestones';
// Every frame's width in CSS pixels, a page's or a terminal's, so that they are
// all one size: what milestones' own tools/board-check.mjs lays the board out at.
const WIDTH = 1440;
// One width for every terminal frame, so the text is one size through the
// series. The widest tables, #20's and #27's, are 151 characters.
const COLS = 156;

// The series, in the order it is told. `pr` is a pull request, taken at its
// head; `commit` a commit on main, for a step that has no pull request of its
// own. `views` are the frames taken of it:
//   term   its terminal: `milestones`, or the board's server once there is one
//   board  the board's page
//   home   the app's home page (from #74, when `milestones` became one app)
const FRAMES = [
  { commit: '23e6886', name: 'plain-table', views: ['term'] },
  { pr: 16, name: 'colour-table', views: ['term'] },
  { pr: 20, name: 'prs-and-untriaged', views: ['term'] },
  { pr: 27, name: 'needs-triage', views: ['term'] },
  { pr: 29, name: 'board', views: ['board', 'term'] },
  { pr: 30, name: 'board-fields', views: ['board'] },
  { pr: 37, name: 'board-dimensions', views: ['board'] },
  { pr: 44, name: 'ui-improvements', views: ['board'] },
  { pr: 58, name: 'board-cards', views: ['board'] },
  { pr: 56, name: 'ui-fixes', views: ['board'] },
  { pr: 74, name: 'app', views: ['home', 'board', 'term'] },
  { pr: 79, name: 'app-ui-fixes', views: ['home', 'board', 'term'] },
];

const run = (cmd, args, cwd = clone) => execFileSync(cmd, args, { cwd, encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The board moves to another port when its own is taken, and it would still
// be found by the URL it prints; but a port something else holds is a sign the
// last run's server is still up.
const free = (port) => new Promise((res, rej) => {
  const p = createServer();
  p.once('error', () => rej(new Error(`port ${port} is taken`)));
  p.once('listening', () => p.close(res));
  p.listen(port, '127.0.0.1');
});

mkdirSync(out, { recursive: true });
if (!existsSync(clone)) run('git', ['clone', '-q', REPO, clone], data);
run('git', ['fetch', '-q', 'origin']);

// The config every version reads. Its path and its `repos` have not changed
// since the first commit; a version from before `buckets` ignores it.
const config = path.join(scratch, 'config');
mkdirSync(config, { recursive: true });
writeFileSync(path.join(config, 'milestones.toml'), `buckets = ${JSON.stringify(BUCKETS)}\nrepos = ${JSON.stringify(TRACKED)}\n`);

// A gh that only reads, ahead of the real one on PATH. gh-readonly.mjs says what it lets through.
const realGh = run('which', ['gh']);
const refused = path.join(scratch, 'refused.log');
rmSync(refused, { force: true });
mkdirSync(path.join(scratch, 'bin'), { recursive: true });
writeFileSync(path.join(scratch, 'bin', 'gh'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(here, 'gh-readonly.mjs'))} "$@"\n`);
chmodSync(path.join(scratch, 'bin', 'gh'), 0o755);

function environment(seq) {
  // A state directory of the frame's own, and empty. milestones finds a running
  // app through it: with the real one, a frame's server would hand its page to
  // whatever milestones is already open on this machine and exit.
  const state = path.join(scratch, `state-${seq}`);
  rmSync(state, { recursive: true, force: true });
  mkdirSync(state, { recursive: true });
  return {
    XDG_CONFIG_HOME: config,
    XDG_STATE_HOME: state,
    // gh keeps its login under XDG_CONFIG_HOME too, and has to go on finding it.
    GH_CONFIG_DIR: process.env.GH_CONFIG_DIR ?? path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'gh'),
    // From #28 on, milestones refuses its own writes under this. Earlier versions have never heard of it.
    MILESTONES_PERMISSIONS: 'read',
    PATH: `${path.join(scratch, 'bin')}${path.delimiter}${process.env.PATH}`,
    SERIES_REAL_GH: realGh,
    SERIES_GH_REFUSED: refused,
  };
}

const wanted = process.argv.slice(2).map(Number);
for (const [i, f] of FRAMES.entries()) {
  if (wanted.length && !wanted.includes(i + 1)) continue;
  const seq = String(i + 1).padStart(2, '0');

  // GitHub keeps refs/pull/<n>/head whatever becomes of the pull request's branch.
  const ref = `refs/shots/${seq}`;
  if (f.pr) run('git', ['fetch', '-q', 'origin', `+refs/pull/${f.pr}/head:${ref}`]);
  else run('git', ['update-ref', ref, f.commit]);
  const head = run('git', ['rev-parse', ref]);
  const pr = f.pr ? JSON.parse(run('gh', ['pr', 'view', String(f.pr), '--json', 'title,url,state'])) : null;
  // When the code was written, on this machine's calendar. Not the merge: #3,
  // which holds two months of the terminal's history, merged in one day.
  const date = run('git', ['show', '-s', '--format=%ad', '--date=format-local:%Y-%m-%d', ref]);
  const base = `${seq}_${date}_${f.name}`;
  const meta = {
    seq, date, step: f.name,
    code: f.pr ? `#${f.pr}` : head.slice(0, 7),
    codeUrl: pr?.url ?? `${REPO}/commit/${head}`,
    change: pr?.title ?? run('git', ['show', '-s', '--format=%s', ref]),
    state: pr?.state ?? 'COMMIT',
    data: `${TRACKED.join(' and ')} as they were when the frame was taken, not when the code was written`,
  };

  const wt = path.join(data, 'milestones-wt', seq);
  spawnSync('git', ['worktree', 'remove', '--force', wt], { cwd: clone });
  run('git', ['worktree', 'add', '-q', '--detach', wt, ref]);
  console.log(`${seq} ${f.name}: ${meta.code} @ ${head.slice(0, 8)}, uv sync`);
  // Installed first and then run from its own .venv, so that uv's "Building
  // milestones" lines are not the first thing in a terminal frame.
  run('uv', ['sync', '--quiet'], wt);
  const bin = path.join(wt, '.venv', 'bin', 'milestones');
  // A version with a page builds it: the bundle is not in the repository.
  if (existsSync(path.join(wt, 'package.json'))) {
    console.log(`${seq} ${f.name}: npm ci, npm run build`);
    run('npm', ['ci', '--no-audit', '--no-fund'], wt);
    run('npm', ['run', 'build'], wt);
  }

  const env = environment(seq);
  const output = (view) => path.join(out, `${base}_${view}.png`);
  const took = (s) => console.log(`  ${s.image}`);
  let server = null;
  try {
    if (!f.views.some((v) => v !== 'term')) {
      // Plain `milestones` is the status table, in every version that is only a terminal tool.
      const s = await captureTerminal({ output: output('term'), width: WIDTH, cols: COLS, show: 'milestones', command: [bin], cwd: wt, env, repo: wt, meta: { ...meta, view: 'term' } });
      if (s.terminal.exitCode !== 0) throw new Error(`milestones exited ${s.terminal.exitCode}: see ${output('term')}`);
      if (s.terminal.wrapped) throw new Error(`a line wrapped at ${COLS} columns: raise COLS`);
      took(s);
    } else {
      const port = 17800 + i + 1;
      await free(port);
      const args = ['board', BOARD, '--port', String(port), '--no-open'];
      // In a terminal of the size its frame will be drawn at (COLS columns at
      // WIDTH is 45 rows), and with the variables over this process's own, as
      // captureTerminal does it.
      server = await spawnPty([bin, ...args], { cols: COLS, rows: 45, cwd: wt, env: { ...process.env, ...env } });
      // Its URL carries a token made for this run, which every page needs.
      // Before #78 the server reads the whole board before it prints it.
      const [printed] = await server.waitFor(/http:\/\/(?:127\.0\.0\.1|localhost):\d+\/\S*/, 300_000);
      const url = new URL(printed);
      const pages = {
        // From #74 the board is one page of an app, at /r/OWNER/NAME/, and / is the home page.
        board: f.views.includes('home') ? `${url.origin}/r/${BOARD}/${url.hash}` : url.href,
        home: `${url.origin}/${url.hash}`,
      };
      // capture() in this process, not shot.mjs through execFileSync as the
      // prcoder series runs it: while this process is blocked nothing reads the
      // server's terminal, and a server logging into a full one waits there.
      for (const view of f.views.filter((v) => v !== 'term')) {
        took(await capture({ url: pages[view], output: output(view), width: WIDTH, setup: path.join(here, 'setup.mjs'), repo: wt, meta: { ...meta, view } }));
      }
      if (f.views.includes('term')) {
        // The server's terminal as the pages left it, drawn from what it wrote.
        const recording = output('term').replace(/\.png$/, '.ansi');
        writeFileSync(recording, server.output());
        took(await captureTerminal({ output: output('term'), width: WIDTH, cols: COLS, show: `milestones ${args.join(' ')}`, replay: recording, repo: wt, meta: { ...meta, view: 'term' } }));
      }
    }
    // This step's frames under any other name (a pull request's head moves, and
    // its date with it) are replaced, not left beside the new ones. Only now
    // the new ones are taken, so a failed run leaves the old in place.
    for (const file of readdirSync(out)) {
      if (file.startsWith(`${seq}_`) && !file.startsWith(`${base}_`)) rmSync(path.join(out, file));
    }
  } finally {
    if (server) {
      server.kill();
      await Promise.race([server.exited, sleep(5000)]);
    }
    spawnSync('git', ['worktree', 'remove', '--force', wt], { cwd: clone });
  }
}

// An index and a contact sheet of whatever frames are there, from their sidecars.
writeIndex(out, {
  title: 'milestones, from a table in a terminal to a board in a browser',
  intro: `Each frame is that step's own code, running. What it shows is ${TRACKED.join(' and ')} as they
were when the frame was taken, not when the code was written.`,
  columns: [['File', '{image}'], ['Code', '[{code}]({codeUrl}) {state}'], ['Commit', '{commit}'], ['Showing', '{change}']],
});
const sheet = await captureSheet({ dir: out, output: path.join(out, 'sheet.png'), width: WIDTH, title: 'milestones, August to November 2026', label: '{date}  {code}  {view}' });
console.log(`  ${sheet.image}`);

if (existsSync(refused)) {
  console.error(`\nA version of milestones tried to write to GitHub, and was refused:\n${readFileSync(refused, 'utf8')}`);
  process.exit(1);
}
