#!/usr/bin/env node
// One screenshot of prcoder per pull request, each taken from that pull
// request's own code showing that pull request. README.md beside this says
// what it needs and what it leaves behind.
//
//   node examples/prcoder-evolution/series.mjs            # every frame in FRAMES
//   node examples/prcoder-evolution/series.mjs 140 203    # only these
//
// Everything it makes is under data/, which is git-ignored.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';

const here = import.meta.dirname;
const root = path.join(here, '..', '..');
const data = path.join(root, 'data');
const clone = path.join(data, 'prcoder');
const out = path.join(data, 'prcoder-evolution');
const REPO = 'https://github.com/gaurav/prcoder';

// Pull request -> the name its frame's file ends in. To add a frame, add a
// line here, and a step in setup.mjs if its feature needs a click to show.
const FRAMES = { 1: 'browser-workspace', 60: 'checks-tab', 112: 'files-pies', 119: 'diff-fold', 140: 'corner-menu',
  152: 'issues-tab', 159: 'pull-requests-tab', 168: 'milestone-line', 181: 'history-tab', 203: 'milestone-viewer' };

const run = (cmd, args, cwd = clone) => execFileSync(cmd, args, { cwd, encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const localDate = (d) => [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((x) => String(x).padStart(2, '0')).join('-');
// prcoder moves to another port when its own is taken, and the frame would
// then be of whatever already held this one.
const free = (port) => new Promise((res, rej) => {
  const p = createServer();
  p.once('error', () => rej(new Error(`port ${port} is taken`)));
  p.once('listening', () => p.close(res));
  p.listen(port, '127.0.0.1');
});

mkdirSync(data, { recursive: true });
if (!existsSync(clone)) run('git', ['clone', '-q', REPO, clone], data);

// prcoder starts its coding agent in a terminal on every page load. This is
// its own stand-in for one, taken from #203, and it is handed over three ways
// because the variable's name changed (#1 reads CLAUDE_BIN, later ones
// PRCODER_AGENT_BIN) and a version that read neither would find `claude` on
// PATH and start a real session.
run('git', ['fetch', '-q', 'origin', '+refs/pull/203/head:refs/shots/pr-203']);
const stub = path.join(data, 'stub', 'claude');
mkdirSync(path.dirname(stub), { recursive: true });
writeFileSync(stub, run('git', ['show', 'refs/shots/pr-203:tools/claude-stub.mjs']));
chmodSync(stub, 0o755);

// A made-up prompt history. #181 onwards reads Claude Code's history.jsonl for
// the History tab and the last-prompt notice, and without this a frame would
// carry real prompts from ~/.claude.
function claudeConfig(cwd) {
  const dir = path.join(data, 'claude-config');
  const now = Date.now(), hour = 3600_000;
  const line = (display, ago, sessionId) => JSON.stringify({ display, pastedContents: {}, timestamp: now - ago, project: cwd, sessionId });
  const a = '6f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b', b = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'history.jsonl'), [
    line('Look at the diff pane\'s wrap button: it folds a long line but the outline stays put', 50 * hour, b),
    line('/simplify', 49 * hour, b),
    line('Add a History tab to the queue, grouped by day and by session', 26 * hour, a),
    line('/code-review high', 3 * hour, a),
    line('Fix the two findings, then run the browser suite in both engines.', 2 * hour, a),
  ].join('\n') + '\n');
  return dir;
}

const wanted = process.argv.slice(2).map(Number);
for (const n of wanted.length ? wanted : Object.keys(FRAMES).map(Number)) {
  const pr = JSON.parse(run('gh', ['pr', 'view', String(n), '--json', 'headRefName,headRefOid,title,mergedAt,state,url']));
  // GitHub keeps refs/pull/<n>/head after a merged pull request's branch is deleted.
  const ref = `refs/shots/pr-${n}`;
  run('git', ['fetch', '-q', 'origin', `+refs/pull/${n}/head:${ref}`]);
  const head = run('git', ['rev-parse', ref]);
  // An open pull request is dated today: it is the code as it stands, and so sorts last.
  // Both on this machine's calendar, not UTC's: an evening merge, or an
  // evening run, west of Greenwich is otherwise dated the next day.
  const date = localDate(pr.mergedAt ? new Date(pr.mergedAt) : new Date());
  const name = `${date}_pr-${String(n).padStart(3, '0')}_${FRAMES[n] ?? pr.headRefName.replace(/[^a-z0-9]+/gi, '-')}`;
  const wt = path.join(data, 'wt', `pr-${n}`);
  const port = 17600 + (n % 300);
  await free(port);

  // On a branch of the pull request's own name, because prcoder finds the
  // pull request to show by the branch it is started on.
  spawnSync('git', ['worktree', 'remove', '--force', wt], { cwd: clone });
  run('git', ['worktree', 'add', '-q', '-B', pr.headRefName, wt, ref]);
  console.log(`#${n}: ${pr.headRefName} @ ${head.slice(0, 8)}, npm ci`);
  // Each version serves xterm from the node_modules beside its own server.js.
  run('npm', ['ci', '--no-audit', '--no-fund'], wt);

  const log = openSync(path.join(data, 'wt', `pr-${n}.log`), 'w');
  const server = spawn('node', ['server.js'], {
    cwd: wt, detached: true, stdio: ['ignore', log, log],
    env: { ...process.env, PATH: `${path.dirname(stub)}:${process.env.PATH}`, CLAUDE_BIN: stub, PRCODER_AGENT_BIN: stub,
      PRCODER_PORT: String(port), PRCODER_NO_OPEN: '1', CLAUDE_CONFIG_DIR: claudeConfig(wt) },
  });
  try {
    let status = '';
    for (let i = 0; i < 60 && !status.includes(`"number":${n}`); i++) {
      await sleep(1000);
      status = await fetch(`http://localhost:${port}/api/status`).then((r) => r.text()).catch(() => '');
    }
    if (!status.includes(`"number":${n}`)) {
      throw new Error(`#${n}: /api/status never named the pull request (data/wt/pr-${n}.log): ${status.slice(0, 300)}`);
    }
    // 1440 wide, as prcoder's own drivers use: its three panes are laid out for it.
    console.log(execFileSync('node', [path.join(root, 'shot.mjs'), `http://localhost:${port}/`, '-o', path.join(out, `${name}.png`),
      '--width', '1440', '--delay', '6000', '--repo', wt, '--setup', path.join(here, 'setup.mjs'),
      '--meta', `pr=${n}`, '--meta', `prTitle=${pr.title}`, '--meta', `prUrl=${pr.url}`, '--meta', `prState=${pr.state}`,
      '--meta', `mergedAt=${pr.mergedAt ?? ''}`, '--meta', 'agent=stub (tools/claude-stub.mjs from #203), not a live Claude session'],
    { encoding: 'utf8', env: { ...process.env, SERIES_PR: String(n) } }).trim());
    // This pull request's frame under any other name (an open pull request's
    // date moves each day) is replaced, not left beside the new one. Only now
    // the new one is taken, so a failed run leaves the old frame in place.
    const tag = `_pr-${String(n).padStart(3, '0')}_`;
    for (const f of readdirSync(out)) {
      if (f.includes(tag) && !f.startsWith(`${name}.`)) rmSync(path.join(out, f));
    }
  } finally {
    // The whole group: the server's terminals each hold a stub.
    try { process.kill(-server.pid); } catch {}
    await sleep(1500);
    spawnSync('git', ['worktree', 'remove', '--force', wt], { cwd: clone });
    spawnSync('git', ['branch', '-D', pr.headRefName], { cwd: clone });
  }
}

// An index of whatever frames are there, from their sidecars.
const rows = readdirSync(out).filter((f) => f.endsWith('.json')).sort().map((f) => {
  const s = JSON.parse(readFileSync(path.join(out, f), 'utf8'));
  return `| ${s.image} | [#${s.meta.pr}](${s.meta.prUrl}) ${s.meta.prState.toLowerCase()} | ${s.subject.commit.slice(0, 8)} | ${s.meta.prTitle} |`;
});
writeFileSync(path.join(out, 'README.md'), `# prcoder, one frame per pull request

Each frame is that pull request's own code showing that pull request. The Claude Code pane is a
stub, not a live session, and the History prompts are made up.

| File | PR | Commit | Showing |
| --- | --- | --- | --- |
${rows.join('\n')}
`);
