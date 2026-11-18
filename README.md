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
| `--repo <path>` | | The git working tree of the software on screen. Its commit, date, branch and remote go in the sidecar. |
| `--meta key=value` | | Repeatable. Anything else worth recording: `--meta pr=203`. |
| `--caption <text>` | | A strip along the bottom, inside the same ratio, carrying the text. `--caption url` shows the page's URL. |

### Taking them again

```sh
node shot.mjs retake data/talk/*.json
```

takes each shot again from what its sidecar recorded (URL, size, browser, wait, setup, caption,
repo and meta) and replaces the image and the sidecar.

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
  "options": { "waitFor": null, "delay": 0, "setup": null, "caption": null },
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
