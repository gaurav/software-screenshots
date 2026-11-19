# milestones, from a table in a terminal to a board in a browser

A series of 16:9 screenshots showing [milestones](https://github.com/gaurav/milestones) changing
over its history: a status table printed to a terminal from August to November 2026, then
`milestones board`, a page in the browser, and then one app with a home page. Each frame is one
step's own code, running.

The terminal frames are taken with [`shot term`](../../README.md#shot-term), the pages with `shot`.

## Running it

Needs Node 24.2 or later, [uv](https://docs.astral.sh/uv/), `git`, and `gh` signed in. From the
top of this repository:

```sh
npm install
npx playwright install chromium
node examples/milestones-evolution/series.mjs          # every step: two minutes, more the first time
node examples/milestones-evolution/series.mjs 5 11     # or only the 5th and 11th
```

The frames land in `data/milestones-evolution/`, each a 2880x1620 PNG with its JSON sidecar, and
for a terminal the bytes it was drawn from:

```
01_2026-08-25_plain-table_term.png
05_2026-11-15_board_board.png
05_2026-11-15_board_term.png
11_2026-11-16_app_home.png
```

That is the step's place in the series, the day its code was last changed, its name, and which
view of it this is. At the end of every run come `README.md`, an index of the frames, and
`sheet.png`, all of them on one slide. A run replaces the frames it takes and leaves the others.

`data/` is git-ignored, so the frames are not in this repository: copy the directory to wherever
the presentation lives.

### Why the number comes first

The prcoder series names its frames by date alone, and they sort. These would not. The board is
a stack of pull requests that have not merged, each built on the one before, and the dates of
their heads are not in the stack's order: #29, the first, was last changed on 15 November, and
#30, built on it, on 11 November. So the order is the `FRAMES` table's, and the number says it.

The date is when the head commit was written, on the running machine's calendar. It is not the
merge date: #3 holds the terminal tool's first two months and merged in a day.

## The steps

| | Code | Views | What changed |
| --- | --- | --- | --- |
| 01 | `23e6886` | term | The first table: repo, milestone, due, open, URL. |
| 02 | #16 | term | Colour, and a percent done. |
| 03 | #20 | term | Pull requests counted, and what is not triaged. |
| 04 | #27 | term | Needs triage as a bucket of its own, left out of the table while it is empty. The last of the terminal tool, and what `main` is today. |
| 05 | #29 | board, term | `milestones board`: a column per milestone. Its terminal is now a server's. |
| 06 | #30 | board | Priority, effort, labels and titles set from the board. |
| 07 | #37 | board | Columns by priority or effort, and groups within a column. |
| 08 | #44 | board | Larger text, a one-line top bar, a card panel that folds away. |
| 09 | #58 | board | The cards redesigned. |
| 10 | #56 | board | Colour-coded group headings, grouped by priority and effort by default. |
| 11 | #74 | home, board, term | One app: a home page over every tracked repo. The terminal is a log. |
| 12 | #79 | home, board, term | The top of the stack as it stands. |

A pull request is taken at its head, so a frame is that pull request as it is now, with whatever
was fixed in it since it was opened. #29's head has fixes that #30's, which branched off earlier,
does not.

## What a run does

For each step, one at a time:

1. Clones milestones to `data/milestones` (first run only) and fetches `refs/pull/<n>/head`.
2. Makes a worktree at `data/milestones-wt/<nn>`.
3. Runs `uv sync` there, and from the first board on, `npm ci` and `npm run build`: the page's
   bundle is not in the repository.
4. For a terminal-only step, runs that version's `milestones` in a pseudo-terminal and takes the
   frame.
5. For a step with a page, starts `milestones board gaurav/milestones --port 178<nn> --no-open`
   in a pseudo-terminal, waits for the URL it prints, takes each page at 1440 CSS pixels wide
   once it has stopped reading, and then draws the server's own terminal from what it wrote.
6. Stops the server and removes the worktree.

## What it is careful about

- **Nothing is written to GitHub**, three ways over. The run starts only `milestones` and
  `milestones board`, which read, and clicks nothing on a page. From #28 on, each version runs
  under `MILESTONES_PERMISSIONS=read`, its own switch for refusing writes, which is why the
  board says *read-only*. And every version, including those from before that switch, finds
  [`gh-readonly.mjs`](gh-readonly.mjs) on its `PATH` ahead of the real `gh`: it passes a `gh api`
  that reads and refuses everything else. A refusal fails the run and is printed at its end.
- **Your own milestones are left alone.** Each version reads a config written for the run, under
  `data/milestones-run/`, not `~/.config/milestones.toml`, and keeps its state in a directory
  made for that frame. The second matters most: milestones runs as one app at a time and finds
  the one already running through its state directory, so with the real one a frame's server
  would hand its page to the milestones open on your machine, and exit.
- **The pull requests page is not taken.** From #74 the app has one listing every pull request of
  yours anywhere on GitHub, private repositories included.

## What the frames do not show

- **The data is today's.** Every version shows `gaurav/milestones` and `NCATSTranslator/Babel` as
  they were when the frame was taken, not as they were when the code was written. The August
  table lists milestones that did not exist in August. Each sidecar says so in `meta.data`.
- **The config is not yours.** It tracks those two repositories and the six standing buckets.
  Change `TRACKED`, `BUCKETS` and `BOARD` at the top of `series.mjs` for others; both of these
  are public.
- **The token in a board's URL**, in the sidecar and in the server's terminal frame, was made
  for that run and stopped working when its server did.

## Changing the series

The steps are the `FRAMES` table at the top of `series.mjs`: a pull request or a commit, the name
its files carry, and the views to take. The series tells its order, so a new step goes where it
belongs in the story and the numbers after it move; run the whole series again after that.

`COLS` is the width of every terminal frame in characters. One width, so the text is one size
through the series; a table that outgrows it fails the run rather than wrap.

`setup.mjs` waits for a page to finish reading. It clicks nothing, and a step that needs a click
to show its feature (a card's panel, a menu) wants care that the click does not write.

`shot retake` runs a terminal-only step's command again, in a worktree that is gone: run
`series.mjs <n>` instead. It can redraw a server's terminal frame from its `.ansi`.
