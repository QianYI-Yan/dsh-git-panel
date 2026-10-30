/**
 * The travelling fill must sit exactly on the active row of every list that
 * hosts it.
 *
 * The fill is absolutely positioned inside its scroller, so it inherits that
 * scroller's positioning context: without `position: relative` on the host it
 * anchors to the panel and lands hundreds of pixels from the row it is supposed
 * to follow. A stylesheet-level assertion cannot catch that — the rule can be
 * present and still lose the cascade — so every host is driven through a real
 * click here and the geometry is measured against its active row.
 *
 * Expected deltas: top and height are exact; the width is the host's horizontal
 * inset on both sides (4px by default, 0 for the history list, whose rows are
 * already inset).
 */
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { fileURLToPath } from 'node:url'

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(new URL('./harness.html', import.meta.url).href)
  for (const file of ['client.js', 'mock-rpc.mjs']) {
    await page.addScriptTag({ path: fileURLToPath(new URL(file, import.meta.url)) })
  }

  const result = await page.evaluate(async () => {
    const now = new Date().toISOString()
    const commits = [
      { hash: 'd196623aaa', shortHash: 'd196623', subject: 'feat: add c', author: 'Tester', dateIso: now, parents: ['de54fc0bbb'], refs: [] },
      { hash: 'de54fc0bbb', shortHash: 'de54fc0', subject: 'init: first commit', author: 'Tester', dateIso: now, parents: [], refs: [] },
    ]
    const snap = {
      root: '/mock', branch: 'main', head: 'd196623', dirty: true,
      unborn: false, staged: 0, modified: 2, untracked: 0, ahead: 0, behind: 0,
      changes: [
        { path: 'a.txt', status: 'modified', staged: false, isDirectory: false },
        { path: 'b.txt', status: 'modified', staged: false, isDirectory: false },
      ],
      stats: { fileCount: 2, staged: 0, modified: 2, untracked: 0, insertions: 3, deletions: 1, lastChangeAt: null, headCommittedAt: null },
      remote: null, refreshIntervalMs: 0, checkedAt: Date.now(),
    }
    const { fixture, connection } = window.createGitPanelMock(snap)
    // Two checkouts, so the repository list has a row to pick: a switch is the
    // only way to move that list's fill.
    fixture.repos = [
      { path: '', root: '/mock', name: 'fixture-repo', kind: 'workspace' },
      { path: 'site', root: '/mock/site', name: 'site', kind: 'nested' },
    ]
    fixture.history = { ok: true, value: { ok: true, value: { kind: 'history', total: commits.length, commits } } }

    const registered = {}
    const ctx = {
      get: (name) => (name === 'connection' ? connection : undefined),
      effect: (callback) => callback(), on: () => () => {}, inject: (_deps, callback) => callback(ctx),
      slots: { inject: (_name, provider) => provider(), register: (reg, component) => { registered[reg.name] = { reg, component }; return () => {} } },
      locale: { register: () => () => {}, bind: () => (key) => key },
    }
    window.__getLoaded().apply(ctx)
    const view = registered['conversation.view']
    const root = window.ReactDOM.createRoot(document.getElementById('panel'))
    root.render(view.component({ sessionId: 'row-slider' }))

    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const waitFor = async (test, label) => {
      const deadline = performance.now() + 6000
      while (!test()) {
        if (performance.now() > deadline) {
          // The failure has to say what the panel looked like: a missing row is
          // usually a pane that never mounted, not a slow one.
          const panel = document.querySelector('.gp-panel')
          const tabs = tabNodes().map((n) => (n.getAttribute('aria-selected') === 'true' ? '*' : '') + n.textContent.trim())
          throw new Error('row-slider: timed out waiting for ' + label
            + ' | tabs=' + tabs.join(',')
            + ' | panel=' + (panel === null ? '(none)' : panel.innerText.replace(/\s+/g, ' ').slice(0, 300)))
        }
        await wait(50)
      }
    }
    const inVisiblePane = (node) => {
      let el = node
      while (el !== null && el !== document.body) {
        if (el.getAttribute('role') === 'tabpanel' && el.style.display === 'none') return false
        el = el.parentElement
      }
      return true
    }
    const tabNodes = () => [...document.querySelectorAll('.gp-panel .gp-tabbar__tabs [role="tab"]')]
    const clickTab = (label) => {
      const node = tabNodes().find((n) => (n.querySelector('.gp-tab__label') || n).textContent.trim() === label)
      if (!node) throw new Error('no tab ' + label + ' in ' + tabNodes().map((n) => n.textContent.trim()).join('|'))
      node.click()
    }
    const textOf = (node, selector) => {
      const found = node.querySelector(selector)
      return found === null ? '' : found.textContent.replace(/\u200e/g, '').trim()
    }
    // Geometry of the fill against the row it follows, read from the pane that
    // is actually on screen (a hidden pane keeps its own copy in the DOM).
    const measure = (hostSelector, activeSelector) => {
      const host = [...document.querySelectorAll('.gp-panel ' + hostSelector)]
        .find((node) => inVisiblePane(node) && node.getBoundingClientRect().width > 0)
      if (host === undefined) return { error: 'no visible ' + hostSelector }
      const slider = host.querySelector('.gp-rowslider')
      if (slider === null) return { error: 'no slider inside ' + hostSelector }
      const active = host.querySelector(activeSelector)
      if (active === null) return { error: 'no ' + activeSelector + ' inside ' + hostSelector }
      const fill = slider.getBoundingClientRect()
      const row = active.getBoundingClientRect()
      return {
        host: hostSelector,
        top: Math.round(fill.top - row.top),
        height: Math.round(fill.height - row.height),
        width: Math.round(fill.width - row.width),
        on: !slider.classList.contains('gp-rowslider--off'),
        anchored: slider.offsetParent === host,
      }
    }

    // A dirty snapshot opens on the changes tab; the overview hosts three of
    // the six lists, so start there.
    await waitFor(() => document.querySelector('.gp-panel .gp-tabbar__tabs [role="tab"]'), 'the tab bar')
    clickTab('tab.overview')
    await waitFor(() => document.querySelector('.gp-panel .gp-commit-row'), 'the history rows')
    await wait(300)

    // 1. The branch tree: its current branch is the active row from the start.
    await waitFor(() => document.querySelector('.gp-panel .gp-branch-row--current'), 'the current branch row')
    await wait(150)
    const branches = measure('.gp-col-left__scroll', '.gp-branch-row--current')

    // 2. The history list: picking a commit moves the fill.
    const commitRows = () => [...document.querySelectorAll('.gp-panel .gp-history__list .gp-commit-row')]
    commitRows()[1].click()
    await waitFor(() => document.querySelector('.gp-panel .gp-history__list .gp-commit-row--active'), 'the active commit')
    await wait(250)
    const history = measure('.gp-history__list', '.gp-commit-row--active')

    // 3. The detail pane's file tree: one row of the commit's stats.
    const detailRows = () => [...document.querySelectorAll('.gp-panel .gp-detail__files .gp-tree-row')]
    await waitFor(() => detailRows().length > 0, 'the detail file tree')
    const detailRowsInfo = detailRows().map((n) => n.className + ':' + textOf(n, '.gp-tree-name')).join('|')
    detailRows().find((n) => !n.classList.contains('gp-tree-row--dir'))?.click()
    await waitFor(() => document.querySelector('.gp-panel .gp-detail__files .gp-tree-row--active'), 'the active detail file among ' + detailRowsInfo)
    await wait(250)
    const detail = measure('.gp-detail__files', '.gp-tree-row--active')

    // 4. The changes list.
    clickTab('tab.changes')
    await waitFor(() => document.querySelector('.gp-panel .gp-changes__list .gp-file-row'), 'the change rows')
    await wait(200)
    document.querySelectorAll('.gp-panel .gp-changes__list .gp-file-row')[1].click()
    await waitFor(() => document.querySelector('.gp-panel .gp-changes__list .gp-file-row--active'), 'the active change')
    await wait(250)
    const changes = measure('.gp-changes__list', '.gp-file-row--active')

    // 5. The files tree.
    clickTab('tab.files')
    const fileRows = () => [...document.querySelectorAll('.gp-panel .gp-files__tree .gp-files__entry')]
    await waitFor(() => fileRows().length > 0, 'the file tree')
    await wait(200)
    const textRow = fileRows().find((node) => textOf(node, '.gp-tree-name') === 'a.txt') ?? fileRows()[0]
    textRow.click()
    await waitFor(() => document.querySelector('.gp-panel .gp-files__tree .gp-files__entry.gp-tree-row--active'), 'the active file')
    await wait(250)
    const files = measure('.gp-files__tree', '.gp-files__entry.gp-tree-row--active')

    // 6. The repository list: a pick from a collapsed block expands it first,
    // then the fill follows the checked row.
    clickTab('tab.overview')
    await wait(250)
    const repolist = () => [...document.querySelectorAll('.gp-panel .gp-repolist')]
      .find((node) => inVisiblePane(node) && node.getBoundingClientRect().width > 0)
    await waitFor(() => repolist() !== undefined, 'the repository list')
    const head = repolist().querySelector('.gp-repolist__head')
    if (head !== null && head.getAttribute('aria-expanded') === 'false') {
      head.click()
      await wait(250)
    }
    const repoRows = () => [...repolist().querySelectorAll('.gp-repolist__item')]
    const siteRow = repoRows().find((node) => textOf(node, '.gp-repolist__name') === 'site')
    if (siteRow === undefined) throw new Error('no site row: ' + repoRows().map((n) => textOf(n, '.gp-repolist__name')).join('|'))
    siteRow.click()
    await waitFor(() => {
      const active = repolist().querySelector('.gp-repolist__item--active')
      return active !== null && textOf(active, '.gp-repolist__name') === 'site'
    }, 'the picked repository row')
    await wait(400)
    const repos = measure('.gp-repolist__list', '.gp-repolist__item--active')

    root.unmount()
    return { branches, history, detail, changes, files, repos, root: fixture.snapshot.root }
  })

  assert.deepEqual(errors, [], 'no browser runtime errors')
  for (const [name, expected] of [
    ['branches', -8], ['history', 0], ['detail', -8], ['changes', -8], ['files', -8], ['repos', -8],
  ]) {
    const box = result[name]
    assert.equal(box.error, undefined, name + ': ' + (box.error ?? ''))
    assert.equal(box.on, true, name + ': the fill is drawn (not hidden)')
    assert.equal(box.anchored, true, name + ': the fill is positioned by its own scroller, not an ancestor')
    assert.ok(Math.abs(box.top) <= 1, name + ': the fill sits on the active row (top ' + box.top + 'px)')
    assert.ok(Math.abs(box.height) <= 1, name + ': the fill matches the row height (delta ' + box.height + 'px)')
    assert.equal(box.width, expected, name + ': the fill keeps the host inset (width ' + box.width + 'px)')
  }
  console.log('row-slider: PASS', JSON.stringify(result))
} finally {
  await browser.close()
}
