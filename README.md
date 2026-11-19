# software-screenshots

Tools for taking screenshots of software for presentations: no browser chrome, a fixed aspect
ratio, and a JSON sidecar beside every image saying how it was made, so it can be cited and taken
again when the software changes.

## shot

```sh
npm install
npx playwright install chromium firefox

node shot.mjs https://example.org -o data/example.png
```

writes `data/example.png` (2560x1440) and `data/example.json`.

| Option | Default | |
| --- | --- | --- |
| `-o, --output <name.png>` | required | The sidecar is `<name>.json` beside it. Directories are made. |
| `--ratio <W:H>` | `16:9` | |
| `--width <px>` | `1280` | The page's width in CSS pixels. Height follows from the ratio. |
| `--scale <n>` | `2` | Device pixel ratio. The image is `width x scale` pixels wide: a page laid out at laptop size, sharp on a projector. Raise `--width` to fit more of a page in; raise `--scale` for more pixels of the same layout. |
| `--browser <name>` | `chromium` | Or `firefox`. |
| `--wait-for <css>` | | A selector that must be visible before the capture. |
| `--delay <ms>` | `0` | Extra time to settle, after everything else. |
| `--setup <file.mjs>` | | A module whose default export is `async (page) => {}`, given the Playwright page after it loads: click a tab, fill a search box, dismiss a banner. |
| `--color-scheme <name>` | | `dark` or `light`: what a page that follows the system's appearance is told. Unset, it is told light, whatever this machine is set to. |
| `--highlight <css>` | | Repeatable. A red ring around the first thing the selector matches, to point at what the frame is about. Drawn last, after `--setup` and `--delay`. A selector matching nothing visible fails the shot. |
| `--repo <path>` | | The git working tree of the software on screen. Its commit, date, branch and remote go in the sidecar. |
| `--meta key=value` | | Repeatable. Anything else worth recording: `--meta pr=203`. |
| `--caption <text>` | | A strip along the bottom, inside the same ratio, carrying the text. `--caption url` shows the page's URL. |

### Taking them again

```sh
node shot.mjs retake data/talk/*.json
```

takes each shot again from what its sidecar recorded (URL, size, browser, wait, setup, caption,
colour scheme, highlights, repo and meta) and replaces the image and the sidecar.

### The sidecar

```json
{
  "image": "example.png",
  "capturedAt": "2026-11-18T23:13:12.133Z",
  "url": "https://example.org",
  "finalUrl": "https://example.org/",
  "pageTitle": "Example Domain",
  "ratio": "16:9",
  "viewport": { "width": 1280, "height": 720 },
  "scale": 2,
  "pixels": { "width": 2560, "height": 1440 },
  "browser": { "name": "chromium", "version": "159.0.8154.6" },
  "playwright": "1.65.1",
  "options": { "waitFor": null, "delay": 0, "setup": null, "caption": null, "colorScheme": null, "highlight": [] },
  "subject": {
    "path": "/path/to/the/tool",
    "repo": "https://github.com/someone/the-tool",
    "commit": "…", "commitDate": "…", "branch": "main", "dirty": false
  },
  "meta": { "pr": "203" },
  "tool": { "name": "software-screenshots", "commit": "…" }
}
```

`subject` is null without `--repo`. `tool.commit` is this repository's commit, which is what to
check out to take the same picture the same way. With a caption, `viewport.height` is the page's
height, 28px less than the image's.

## shot term

A frame of a command's terminal output, for a tool with no page to load:

```sh
node shot.mjs term -o data/status.png --cols 120 --show 'milestones status' -- uv run milestones status
```

The command runs in a pseudo-terminal, so a tool that colours its output only for a terminal
colours it here, and its bytes are drawn by [xterm.js](https://xtermjs.org) in the same headless
page a URL's shot is taken in. `--output`, `--ratio`, `--width`, `--scale`, `--browser`, `--repo`,
`--meta` and `--caption` mean what they do above. Its own options:

| Option | Default | |
| --- | --- | --- |
| `-- <command>...` | | Everything after `--` is the command and its arguments. |
| `--cols <n>` | `100` | The terminal's width in characters. The font is sized so that they fill the frame, and the rows are however many then fit: 100 columns at 16:9 is 28 rows. The command sees a terminal of exactly that size. |
| `--theme <name>` | `dark` | Or `light`. |
| `--font <css>` | Menlo, or the platform's monospace | A CSS `font-family`. |
| `--show <text>` | the command | What the prompt line above the output says was run, when that is not what was: `milestones`, not `/path/to/.venv/bin/milestones`. The sidecar records both. |
| `--no-prompt` | | No prompt line. |
| `--scroll <end>` | `bottom` | Output longer than the frame shows its last screenful, as a terminal would. `top` shows its first. |
| `--cwd <dir>` | here | Where the command runs. |
| `--env KEY=value` | | Repeatable. Variables for the command, over this shell's. They go in the sidecar, so no secrets. |
| `--until <regex>` | | For a command that does not end, like a server: stop it once its output matches, and take the frame. Matched against the text without its colour codes. |
| `--timeout <ms>` | | With `--until`, how long to wait for the match (default 30000) before failing. Alone, stop the command after this long and take what is there. |
| `--replay <file.ansi>` | | Instead of a command: draw bytes recorded earlier. |

A line that wrapped, or output that did not fit, is a warning on stderr and a count in the
sidecar (`wrapped`, `scrolledOff`), since a table folded at the frame's edge is rarely the picture
wanted: raise `--cols`.

Beside the image and its sidecar goes `<name>.ansi`, the bytes the command wrote. `shot retake`
on a terminal's sidecar runs the command again; when the frame came from `--replay`, it draws
the recording again.

In the sidecar, `terminal` takes the place of `url`, `finalUrl` and `pageTitle`:

```json
"terminal": {
  "command": ["uv", "run", "milestones", "status"],
  "shown": "milestones status",
  "cwd": "/path/to/the/tool", "env": {}, "exitCode": 0,
  "recording": "status.ansi",
  "cols": 120, "rows": 34, "fontSize": 17.25, "font": "Menlo, …", "theme": "dark",
  "prompt": "$ ", "scroll": "bottom", "until": null, "timeout": null,
  "lines": 19, "wrapped": 0, "scrolledOff": 0
}
```

`term.mjs` also exports `spawnPty` and `record`, for a script that has to start a server in a
terminal, photograph its page, and then photograph the terminal.

### Installing

`npm install` and `npm ci` run `tools/postinstall.mjs`, which makes node-pty's prebuilt
`spawn-helper` executable. npm does not, and without it every `shot term` fails with a bare
`posix_spawnp failed`. `npm install <package>` does not run it: follow it with `npm install`.

## A series through a tool's history

For a tool with a web UI, check out each version of interest in its own `git worktree`, start it,
and take one shot per version with `--repo <worktree>`, naming the files so they sort by time:
`2026-10-14_pr-140_corner-menu.png`. The checking out and starting differ per tool, so each series
is a script of its own under `examples/`, writing into `data/` (git-ignored).

[examples/prcoder-evolution](examples/prcoder-evolution/README.md) is the first: ten frames of
[prcoder](https://github.com/gaurav/prcoder), one per pull request, each from that pull request's
own code. `node examples/prcoder-evolution/series.mjs` takes them all.

## Tests

`npm test`. The capture test skips when Chromium is not installed.
