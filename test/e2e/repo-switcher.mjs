/**
 * E2E: the repository list and the checkout it selects.
 *
 * A workspace may hold nested repositories beside its own checkout (issue
 * #83). The Git overview lists every checkout in its left column, above the
 * branch tree, so picking one keeps branches, commit list and the list itself
 * on screen together; the pick rides every repository-scoped request while the
 * panes themselves never learn about it. The compact layout has no left column,
 * so it keeps a Repositories page; a cwd that is not a checkout has no overview
 * either, so its browser carries the same rows as a strip above the tree.
 * A switch never blanks the panel: the old sample stays up, dimmed, under a
 * "switching" badge until the new one lands. A host that cannot answer the scan
 * keeps the three-pane panel unchanged.
 *
 * Fully isolated — a local file:// harness, no dsh server, no touch of any
 * running instance. Requires the e2e fixtures (run test/e2e/setup.mjs first,
 * or `npm run test:e2e` which chains it).
 */
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const DIR = dirname(fileURLToPath(import.meta.url))
const harness = 'file://' + resolve(DIR, 'harness.html')

// A clean checkout: the list is what this runner measures, so the panes stay
// quiet (no expanded lists, no diffs, no image fetches).
const SNAP = {
  root: 'fixture-repo', branch: 'main', head: 'de54fc0', unborn: false, dirty: false,
  staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0, hasUpstream: true,
  remote: null, lastCommit: null, changes: [],
  stats: { fileCount: 0, staged: 0, modified: 0, untracked: 0, insertions: 0, deletions: 0, lastChangeAt: null, headCommittedAt: null },
  truncated: false, refreshIntervalMs: 0, showInputPill: true, defaultDiffView: 'unified', checkedAt: Date.now(),
}

const WORKSPACE_REPO = { path: '', root: 'fixture-repo', name: 'fixture-repo', kind: 'workspace' }
const NESTED_REPO = { path: 'site', root: 'fixture-repo/site', name: 'site', kind: 'nested' }
// A checkout whose folder name does not identify it: the row needs the path.
const DEEP_REPO = { path: 'apps/web', root: 'fixture-repo/apps/web', name: 'web', kind: 'nested' }

const browser = await chromium.launch()

/**
 * Mount the panel in a fresh page. `action` drives the page ('inspect' only
 * observes; 'switch' also moves between checkouts) and the page hands back
 * observations so every assertion stays on this side of the RPC.
 */
async function mount(repos, action, options = {}) {
  const page = await browser.newPage()
  const errors = []
  page.on('console', (msg) => { if (msg.type() === 'error' || msg.text().includes('GPSEL')) errors.push(msg.text()) })
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
  await page.goto(harness)
  await page.addScriptTag({ path: resolve(DIR, 'client.js') })
  await page.addScriptTag({ path: resolve(DIR, 'mock-rpc.mjs') })
  const snapshotFails = options.snapshotFails === true
  const snap = options.dirty === true
    ? { ...SNAP, dirty: true, modified: 2, changes: [{ path: 'a.txt', status: 'M', side: 'worktree' }] }
    : SNAP
  const scene = options.scene || 'scene'
  const out = await page.evaluate(async ({ snap, repos: listed, action, snapshotFails, scene }) => {
    const React = window.React
    const origWarn = console.warn.bind(console)
    console.warn = (...args) => origWarn('[' + scene + ']', ...args)
    const { fixture, connection } = window.createGitPanelMock(snap)
    fixture.repos = listed
    // Every repository-scoped request, so the test can prove the pick reaches
    // the wire rather than only the row highlight. The client captures the
    // connection face before apply(), so patch it first.
    const calls = []
    const mockCall = connection.rpc.call
    connection.rpc.call = async (channel, endpoint, payload) => {
      const request = payload && payload.args && payload.args.request
      calls.push({
        endpoint,
        kind: request && request.query ? request.query.kind : null,
        repo: request && typeof request.repo === 'string' ? request.repo : '',
      })
      // A workspace directory that is not a checkout: the session root has no
      // repository of its own, only nested ones, so only the untagged request
      // fails. A pick of a nested checkout answers normally, which is what lets
      // the strip carry the browser into a git view.
      if (snapshotFails && endpoint === 'gitPanel/snapshot') {
        const tag = request && typeof request.repo === 'string' ? request.repo : ''
        if (tag === '') return { ok: true, value: { ok: false, error: { code: 'not-a-git-repo', cwd: '/mock/workspace' } } }
        return { ok: true, value: { ok: true, value: { ...snap, root: 'fixture-repo/' + tag } } }
      }
      return mockCall(channel, endpoint, payload)
    }
    const entry = window.__getLoaded()
    if (!entry || typeof entry.apply !== 'function') return { error: 'plugin did not load' }
    const registered = {}
    const services = { connection }
    const ctx = {
      get: (k) => services[k],
      effect: (cb) => { try { cb() } catch (e) { /* ignore */ } },
      on: () => () => {},
      inject: (_deps, cb) => cb(ctx),
      slots: {
        inject: (name, provider) => provider(),
        register: (reg, component) => { registered[reg.name] = { reg, component }; return () => {} },
      },
      locale: { register: () => () => {}, bind: () => (key) => key },
    }
    entry.apply(ctx)
    const view = registered['conversation.view']
    if (!view) return { error: 'conversation.view was not registered' }
    // `component(props)` returns the mounted element; wrapping it in another
    // createElement would hand React the element object as a component type.
    window.ReactDOM.createRoot(document.getElementById('panel'))
      .render(view.component({ sessionId: 'sess-1' }))
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    await wait(500)

    const textOf = (node, selector) => {
      const found = node.querySelector(selector)
      return found === null ? '' : found.textContent.trim()
    }
    const tabNodes = () => [...document.querySelectorAll('.gp-panel .gp-tabbar__tabs [role="tab"]')]
    const tabLabels = () => tabNodes().map((node) => (node.querySelector('.gp-tab__label') || node).textContent.trim())
    const activeTabLabel = () => {
      const node = tabNodes().find((n) => n.getAttribute('aria-selected') === 'true')
      return node ? (node.querySelector('.gp-tab__label') || node).textContent.trim() : null
    }
    const clickTab = (label) => {
      const node = tabNodes().find((n) => (n.querySelector('.gp-tab__label') || n).textContent.trim() === label)
      if (!node) throw new Error('no tab ' + label + ' in ' + tabLabels().join('|'))
      node.click()
    }
    // The left column of the overview: the list has to live inside it, beside
    // the branch tree, not on a page of its own.
    const listInLeftColumn = () => {
      const left = document.querySelector('.gp-panel .gp-col--left')
      return left !== null && left.querySelector('.gp-repolist') !== null
    }
    const listRows = () => [...document.querySelectorAll('.gp-panel .gp-repolist__item')].map((node) => ({
      name: textOf(node, '.gp-repolist__name'),
      meta: textOf(node, '.gp-repolist__meta'),
      active: node.classList.contains('gp-repolist__item--active'),
      current: node.getAttribute('aria-current'),
      count: textOf(node, '.gp-repolist__count'),
    }))
    const cardRows = () => [...document.querySelectorAll('.gp-panel .gp-repos__item')].map((node) => ({
      name: textOf(node, '.gp-repos__name'),
      path: textOf(node, '.gp-repos__path'),
      active: node.classList.contains('gp-repos__item--active'),
      current: node.getAttribute('aria-current'),
    }))
    const pickRow = (selector, name) => {
      const row = [...document.querySelectorAll('.gp-panel ' + selector)]
        .find((node) => textOf(node, selector.replace('__item', '__name')) === name)
      if (!row) {
        const panel = document.querySelector('.gp-panel')
        const have = [...document.querySelectorAll('.gp-panel ' + selector)].map((node) => textOf(node, selector.replace('__item', '__name')))
        const tabs = [...panel.querySelectorAll('.gp-tabbar [role="tab"]')].map((node) => (node.getAttribute('aria-selected') === 'true' ? '*' : '') + node.textContent.trim())
        const body = [...panel.querySelectorAll('.gp-body > *')].map((node) => node.className + '|' + node.textContent.trim().slice(0, 40))
        throw new Error('no repository row ' + name + ' in ' + selector + ' (have ' + have.join('|') + ') tabs=' + tabs.join(',') + ' body=' + body.join(' ; '))
      }
      row.click()
    }
    // The body dims and the tab bar shows a badge while the next sample is in
    // flight; the list itself must stay put, or the switch reads as a collapse.
    const switchingNow = () => document.querySelector('.gp-panel').getAttribute('data-repo-switching') === 'true'
    // The strip above the file tree: the browser is the only page of a cwd with
    // no checkout, so its rows are the way into any git view.
    const stripInfo = () => {
      const node = document.querySelector('.gp-panel .gp-files__repos')
      const files = document.querySelector('.gp-panel .gp-files')
      return {
        present: node !== null,
        rows: node === null ? [] : [...node.querySelectorAll('.gp-repolist__item')].map((row) => ({
          name: textOf(row, '.gp-repolist__name'),
          active: row.classList.contains('gp-repolist__item--active'),
        })),
        // DOCUMENT_POSITION_FOLLOWING (4): the browser starts after the strip.
        aboveTree: node !== null && files !== null && (node.compareDocumentPosition(files) & 4) !== 0,
      }
    }

    const observed = {
      tabs: tabLabels(),
      tabCount: document.querySelector('.gp-panel .gp-tabbar').getAttribute('data-tab-count'),
      switching: switchingNow(),
      strip: stripInfo(),
      // The requests sent before any pick: the root sample must never be tagged.
      rootCalls: calls.slice(),
    }
    if (action === 'switch' && observed.tabs.includes('tab.overview') && activeTabLabel() !== 'tab.overview') {
      // A dirty checkout opens on Changes; the list lives in the overview.
      clickTab('tab.overview')
      await wait(300)
    }
    observed.activeTab = activeTabLabel()
    observed.inLeftColumn = listInLeftColumn()
    observed.rows = listRows()
    if (action !== 'switch') {
      // The standalone page (compact layout) only exists when the bar carries a
      // Repositories tab; read its cards from there.
      if (observed.tabs.includes('tab.repos')) {
        clickTab('tab.repos')
        await wait(250)
        observed.cards = cardRows()
        observed.activeTab = activeTabLabel()
      }
      return { observed, calls }
    }

    // Park the sample the pick triggers, so the in-flight state can be read
    // before the new snapshot replaces the old one.
    let mark = calls.length
    fixture.holdSnapshot = true
    pickRow('.gp-repolist__item', 'site')
    await wait(250)
    observed.duringSwitch = {
      switching: switchingNow(),
      badge: textOf(document.querySelector('.gp-panel .gp-tabbar'), '.gp-tabbar__switching'),
      inLeftColumn: listInLeftColumn(),
      rows: listRows(),
      tabCount: document.querySelector('.gp-panel .gp-tabbar').getAttribute('data-tab-count'),
      strip: stripInfo(),
    }
    if (typeof fixture.releaseSnapshot === 'function') fixture.releaseSnapshot()
    fixture.holdSnapshot = false
    await wait(700)
    observed.afterNested = {
      activeTab: activeTabLabel(), tabs: tabLabels(), inLeftColumn: listInLeftColumn(),
      rows: listRows(), switching: switchingNow(), strip: stripInfo(), calls: calls.slice(mark),
    }
    // A cwd without a checkout of its own lists no workspace row to return to;
    // the pick is the last step there.
    if (listRows().some((row) => row.name === 'fixture-repo')) {
      mark = calls.length
      pickRow('.gp-repolist__item', 'fixture-repo')
      await wait(600)
      observed.afterBack = { activeTab: activeTabLabel(), rows: listRows(), calls: calls.slice(mark) }
    }
    return { observed, calls }
  }, { snap, repos, action, snapshotFails, scene })
  await page.close()
  return { out, errors }
}

const failures = []

// 1. A host that cannot answer the scan: the panel keeps its three panes, no
// list, and never tags a request.
{
  const { out, errors } = await mount([], 'inspect')
  try {
    assert.equal(out.error, undefined, 'the panel mounted')
    assert.deepEqual(out.observed.tabs, ['tab.overview', 'tab.changes', 'tab.files'], 'no scan result means no repository list')
    assert.equal(out.observed.tabCount, '3', 'the bar reports its tab count for the compact indicator')
    assert.equal(out.observed.inLeftColumn, false, 'nothing to list')
    assert.ok(out.calls.length > 0, 'the panel still asked for a snapshot')
    assert.ok(out.calls.every((call) => call.repo === ''), 'a single checkout never tags requests')
    assert.deepEqual(errors, [], 'no page errors: ' + JSON.stringify(errors))
  } catch (error) {
    console.error('scan-less observation: ' + JSON.stringify({ observed: out.observed, calls: out.calls, errors }))
    failures.push(error)
  }
}

// 2. A lone checkout: there is nothing to pick between, so the bar stays at
// three tabs and the overview shows no list at all.
{
  const { out, errors } = await mount([WORKSPACE_REPO], 'inspect', { dirty: true })
  try {
    assert.equal(out.error, undefined, 'the panel mounted')
    const seen = out.observed
    assert.deepEqual(seen.tabs, ['tab.overview', 'tab.changes', 'tab.files'], 'one checkout needs no tab')
    assert.equal(seen.inLeftColumn, false, 'and no list either')
    assert.deepEqual(seen.rows, [], 'no rows are rendered')
    assert.ok(out.calls.every((call) => call.repo === ''), 'nothing is tagged while only one checkout exists')
    assert.deepEqual(errors, [], 'no page errors: ' + JSON.stringify(errors))
  } catch (error) {
    console.error('single-checkout observation: ' + JSON.stringify({ observed: out.observed, calls: out.calls, errors }))
    failures.push(error)
  }
}

// 3. A workspace plus nested checkouts: the list rides in the overview's left
// column, and a pick moves the requests without leaving that page.
{
  const { out, errors } = await mount([WORKSPACE_REPO, NESTED_REPO, DEEP_REPO], 'switch', { dirty: true })
  try {
    assert.equal(out.error, undefined, 'the panel mounted')
    const seen = out.observed
    assert.deepEqual(seen.tabs, ['tab.overview', 'tab.changes', 'tab.files'], 'the list needs no tab of its own')
    assert.equal(seen.inLeftColumn, true, 'the list sits in the overview left column')
    assert.deepEqual(seen.rows.map((row) => row.name), ['fixture-repo', 'site', 'web (apps/web)'], 'every checkout is listed')
    assert.deepEqual(seen.rows.map((row) => row.active), [true, false, false], 'the workspace checkout starts checked')
    assert.equal(seen.rows[1].meta, '', 'a folder that names the checkout needs no second line')
    assert.equal(seen.rows[2].meta, 'apps/web', 'a nested row carries its relative path')
    assert.equal(seen.rows[0].current, 'true')
    assert.ok(seen.rows[0].meta.includes('main'), 'the checked row reports its branch: ' + seen.rows[0].meta)
    assert.equal(seen.rows[0].count, '2', 'and how many files are pending')
    // `repo-list` is the one query that spans the whole workspace — it has to
    // stay untagged, or the list could not offer the checkouts it switches
    // between.
    const scoped = (calls) => calls.filter((call) => call.kind !== 'repo-list')
    const nestedCalls = seen.afterNested.calls
    // The switch never blanks the panel: the previous sample stays up, dimmed,
    // with a badge naming the reason, and the list keeps its rows.
    assert.equal(seen.duringSwitch.switching, true, 'the switch is announced instead of collapsing the panel')
    assert.equal(seen.duringSwitch.badge, 'repo.switching', 'the tab bar names the reason')
    assert.equal(seen.duringSwitch.inLeftColumn, true, 'the list never leaves the column mid-switch')
    assert.equal(seen.duringSwitch.tabCount, '3', 'and the tabs stay mounted')
    assert.deepEqual(seen.duringSwitch.rows.map((row) => row.active), [false, true, false], 'the picked row is checked immediately')
    assert.equal(seen.afterNested.activeTab, 'tab.overview', 'picking a checkout stays on the overview')
    assert.equal(seen.afterNested.inLeftColumn, true, 'the list stays on screen while the panes reload')
    assert.equal(seen.afterNested.switching, false, 'the badge clears once the new sample lands')
    assert.deepEqual(seen.afterNested.rows.map((row) => row.active), [false, true, false], 'the list marks the checkout the panes act on')
    assert.ok(nestedCalls.some((call) => call.endpoint === 'gitPanel/snapshot'), 'the switch refetched a snapshot')
    assert.ok(nestedCalls.length > scoped(nestedCalls).length, 'the workspace listing was re-read after the switch')
    assert.ok(scoped(nestedCalls).every((call) => call.repo === 'site'), 'every repository-scoped request carries the picked checkout: ' + JSON.stringify(nestedCalls))
    assert.equal(seen.afterBack.activeTab, 'tab.overview', 'switching back stays on the overview')
    assert.deepEqual(seen.afterBack.rows.map((row) => row.active), [true, false, false], 'and marks the workspace checkout again')
    assert.ok(scoped(seen.afterBack.calls).every((call) => call.repo === ''), 'the workspace checkout sends no tag: ' + JSON.stringify(seen.afterBack.calls))
    assert.deepEqual(errors, [], 'no page errors: ' + JSON.stringify(errors))
  } catch (error) {
    console.error('switch observation: ' + JSON.stringify({ observed: out.observed, calls: out.calls, errors }))
    failures.push(error)
  }
}

// 4. A workspace directory that is not a checkout, holding a single nested
// repository: the browser is the only page it has, so the list rides above the
// file tree there — and picking the nested checkout lands on the overview it
// now has.
{
  const { out, errors } = await mount([NESTED_REPO], 'switch', { snapshotFails: true, scene: 'S4' })
  try {
    assert.equal(out.error, undefined, 'the panel mounted')
    const seen = out.observed
    assert.deepEqual(seen.tabs, ['tab.files'], 'without an overview the browser is the only page')
    assert.equal(seen.tabCount, '1', 'a lone page does not stretch the bar selector')
    assert.equal(seen.activeTab, 'tab.files', 'and it is what opens')
    assert.equal(seen.strip.present, true, 'the repository strip rides above the tree')
    assert.equal(seen.strip.aboveTree, true, 'literally above it, not beside it')
    assert.deepEqual(seen.strip.rows, [
      { name: 'repo.root', active: true },
      { name: 'site', active: false },
    ], 'the workspace root leads as the way back, then the one checkout')
    assert.ok(seen.rootCalls.filter((call) => call.kind !== 'repo-list').every((call) => call.repo === ''), 'the root pick tags nothing')
    // Picking a checkout that exists turns the browser into a three-pane panel.
    assert.deepEqual(seen.afterNested.tabs, ['tab.overview', 'tab.changes', 'tab.files'], 'the checkout brings the git panes back')
    assert.equal(seen.afterNested.activeTab, 'tab.overview', 'and the pick lands on the overview')
    assert.equal(seen.afterNested.inLeftColumn, true, 'where the list now lives')
    assert.equal(seen.afterNested.strip.present, false, 'the browser drops the strip once it is no longer the only page')
    assert.deepEqual(seen.afterNested.rows.map((row) => row.active), [false, true], 'the nested checkout is checked')
    assert.deepEqual(errors, [], 'no page errors: ' + JSON.stringify(errors))
  } catch (error) {
    console.error('non-checkout observation: ' + JSON.stringify({ observed: out.observed, calls: out.calls, errors }))
    failures.push(error)
  }
}

await browser.close()

if (failures.length > 0) {
  console.error('repo-switcher: ' + failures.length + ' failed')
  for (const failure of failures) console.error(failure)
  process.exit(1)
}
console.log('repo-switcher: ok')
