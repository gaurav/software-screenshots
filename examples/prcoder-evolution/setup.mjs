// What each frame clicks before it is taken, so that it shows the feature its
// pull request added. Passed to shot as --setup by series.mjs, which names the
// pull request in SERIES_PR.
//
// Every click here only reads: tabs, the corner menu, a file's row, and #203's
// milestone line, which opens the viewer and writes nothing. #168 has no entry
// on purpose: its milestone line is a picker that moves the pull request on
// GitHub. The route below refuses the writes prcoder can make to GitHub, in
// case a selector lands somewhere else in some version.
const WRITES = /\/api\/pr\/(viewed|milestone|body|check|tick)|\/api\/(issue|pull)\/milestone|\/api\/queue\/file/;

const tab = (page, text) => page.locator('.tab').filter({ hasText: text }).first().click();
const queueTab = (page, name) => page.locator(`#queue-body .tab[data-tab="${name}"]`).click();
// A .js file, not the first row: that is .gitignore, and then package-lock.json.
const openFile = async (page) => {
  await tab(page, /Files/);
  await page.locator('.file').filter({ hasText: /\.js(?!on)/ }).first().click();
};

const STEPS = {
  1: openFile,
  60: (page) => tab(page, /Checks/),
  112: (page) => tab(page, /Files/),
  119: openFile,
  140: (page) => page.locator('#menu summary').click(),
  152: (page) => queueTab(page, 'issues'),
  159: (page) => queueTab(page, 'pulls'),
  181: (page) => tab(page, /History/),
  203: (page) => page.getByText('No milestone').first().click(),
};

// From #181 prcoder says the last prompt sent once the agent connects: a toast
// over the queue in #181, a line in #notices from #203. It goes up a moment
// after the page loads, so it may come after this setup, and a click on its ✕
// would race it. Instead every one is taken down as it appears, the way
// prcoder's own ✕ does it: the toast hidden, the notice removed, so an empty
// #notices collapses (hiding the line with CSS would leave its bar behind).
function hideLastPrompt() {
  const sweep = () => {
    const t = document.getElementById('toast');
    // Only when shown: setting `hidden` again is itself a mutation, and the
    // observer would answer it forever.
    if (t?.dataset.kind === 'last-prompt' && !t.hidden) t.hidden = true;
    for (const li of document.querySelectorAll('#notices > li[data-kind="last-prompt"]')) li.remove();
  };
  sweep();
  new MutationObserver(sweep).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'data-kind'] });
}

export default async function setup(page) {
  await page.route(WRITES, (route) => route.abort());
  await page.evaluate(hideLastPrompt);
  await STEPS[process.env.SERIES_PR]?.(page);
}
