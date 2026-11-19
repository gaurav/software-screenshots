# prcoder, one frame per pull request

A series of 16:9 screenshots showing [prcoder](https://github.com/gaurav/prcoder)'s interface
changing over its history. Each frame is one pull request's own code, running, showing that pull
request: prcoder always has a pull request on screen, so each version shows the one that made it.

## Running it

Needs Node 24.2 or later, `git`, and `gh` signed in to an account that can read
`gaurav/prcoder`. From the top of this repository:

```sh
npm install
npx playwright install chromium
node examples/prcoder-evolution/series.mjs            # all ten frames, about a minute each
node examples/prcoder-evolution/series.mjs 140 203    # or only some
```

The frames land in `data/prcoder-evolution/`, each a 2880x1620 PNG with its JSON sidecar, named
so they sort by time: `2026-10-14_pr-140_corner-menu.png`. A merged pull request is dated by its
merge, an open one by the day of the run, both on the running machine's calendar rather than UTC's.
`data/prcoder-evolution/README.md` is an index written at the end of every run. A run replaces the
frames it takes, including one of the same pull request under another date, and leaves the others.

`data/` is git-ignored, so the frames are not in this repository: copy the directory to wherever
the presentation lives.

## What a run does

For each pull request, one at a time:

1. Clones prcoder to `data/prcoder` (first run only) and fetches `refs/pull/<n>/head`.
2. Makes a worktree at `data/wt/pr-<n>` on a branch with the pull request's own name, since
   prcoder finds the pull request to show by the branch it is started on.
3. Runs `npm ci` there.
4. Starts that version's `server.js` in the worktree, on port 17600 + n, and waits until
   `/api/status` names the pull request.
5. Runs [`shot.mjs`](../../shot.mjs) on it at 1440 CSS pixels wide, with `setup.mjs` making the
   one click that brings the pull request's feature on screen.
6. Stops the server and removes the worktree and branch.

## What it is careful about

- **No coding agent is started.** prcoder opens a terminal running Claude Code on every page
  load. The run gives it prcoder's own stub instead, so the Claude Code pane in every frame is an
  empty terminal.
- **No real prompts appear.** From #181 prcoder shows Claude Code's prompt history; the run points
  it at a made-up one under `data/claude-config`.
- **Nothing is written to GitHub.** prcoder can tick a description's checkbox, mark a file viewed
  and move a pull request between milestones. `setup.mjs` clicks only things that read, and
  refuses those requests in the page besides. #168's milestone line is a picker that moves the
  pull request, so that frame takes no click.
- **It does not touch another prcoder checkout.** The clone under `data/` is its own.

## Changing the series

The frames are the `FRAMES` table at the top of `series.mjs`: pull request number to the name the
file ends in. A new frame also wants a line in `STEPS` in `setup.mjs` if its feature is behind a
tab or a menu. Selectors differ between versions of prcoder, so look at the PNG after adding one.

`shot retake` cannot redo these frames from their sidecars: the URL is a local server that has
stopped. Run `series.mjs <n>` again.

## Known rough edges

- In #181's frame the "Last prompt" notice lies over the first History rows. Both are that pull
  request's feature. A click on the notice's ✕ in `STEPS` would clear it.
- A version that does not start fails the run with the tail of `/api/status`; its log is
  `data/wt/pr-<n>.log`.
