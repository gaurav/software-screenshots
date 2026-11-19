#!/usr/bin/env node
// A `gh` that only reads. series.mjs puts it ahead of the real one on PATH, so
// that no version of milestones it starts can change anything on GitHub,
// whatever a frame's command turns out to do in that version.
//
// milestones makes every call as `gh api`: REST with `-X <METHOD>` (in every
// version: its gh.py has passed the method explicitly since the first), and
// GraphQL as `gh api graphql -f query=...`. So what passes is `gh api` with no
// method or GET and no request body, and a GraphQL document that is not a
// mutation; `gh auth` and `gh --version`, which only report; and nothing else.
// A refusal is one line in $SERIES_GH_REFUSED, which a run ends by reading.
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

/** Why this call is refused, or null when it only reads. */
export function refusal(args) {
  if (['--version', 'version', 'auth'].includes(args[0])) return null;
  if (args[0] !== 'api') return `gh ${args[0]} is not a call this series expects`;
  let method = null;
  let body = false;
  let fields = false;
  args.forEach((a, i) => {
    if (a === '-X' || a === '--method') method = args[i + 1] ?? '';
    else if (a.startsWith('--method=')) method = a.slice(9);
    else if (/^-X./.test(a)) method = a.slice(2);
    else if (a === '--input' || a.startsWith('--input=')) body = true;
    else if (/^(-f|-F|--field|--raw-field)(=|$)/.test(a)) fields = true;
  });
  if (args.includes('graphql')) {
    // The word anywhere an operation could start, not only first: a document
    // may open with a comment, or hold a query and a mutation both.
    const document = args.find((a) => a.startsWith('query='))?.slice(6) ?? '';
    if (body || method || !document.trim() || /(^|[\s}])mutation\b/.test(document)) return 'a GraphQL call that is not plainly a query';
    return null;
  }
  // gh makes a call with fields a POST unless told GET. milestones always tells it.
  const verb = (method ?? (fields ? 'POST' : 'GET')).toUpperCase();
  if (verb !== 'GET' || body) return `${verb}${body ? ' with a body' : ''}`;
  return null;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const why = refusal(args);
  if (why) {
    const line = `refused (${why}): gh ${args.join(' ').slice(0, 300)}`;
    if (process.env.SERIES_GH_REFUSED) appendFileSync(process.env.SERIES_GH_REFUSED, line + '\n');
    console.error(`gh-readonly: ${line}`);
    process.exit(1);
  }
  const done = spawnSync(process.env.SERIES_REAL_GH, args, { stdio: 'inherit' });
  process.exit(done.status ?? 1);
}
