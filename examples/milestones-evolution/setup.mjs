// What a board or home page frame waits for before it is taken. Passed to shot
// as its setup by series.mjs.
//
// It clicks nothing. Every frame is the page as it opens, and on a board nearly
// every click is a write: a card dragged, a milestone or a priority picked.
// (The server is read-only besides, and so is the gh it calls; see README.md.)

// A long time: the page comes up at once and then fills, and a board is read
// from GitHub a page of issues at a time.
const timeout = 300_000;

export default async function setup(page) {
  // The board's columns, or the home page's table of milestones. The same
  // class names from the first board (#29) to the app (#79).
  await page.locator('.columns, table.milestones').first().waitFor({ state: 'visible', timeout });
  // Then until nothing says it is still reading: the Refresh button reads
  // "Reading…" while a board fills (with a count from #78), and the home
  // page's sections say it in place of their rows.
  await page.waitForFunction(
    () => ![...document.querySelectorAll('button, .muted, .fatal')].some((el) => /^Reading/.test(el.textContent.trim())),
    null, { timeout });
  await page.waitForTimeout(500);
}
