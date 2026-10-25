/**
 * E2E: the repository list and the checkout it selects.
 *
 * A workspace may hold nested repositories beside its own checkout (issue
 * #83). The Git overview lists every checkout in its left column, above the
 * branch tree, so picking one keeps branches, commit list and the list itself
 * on screen together; the pick rides every repository-scoped request while the
 * panes themselves never learn about it. Two layouts fall back to a page of
 * their own: the compact one (no left column) and a cwd that is not a checkout
 * (no overview to put a list in). A host that cannot answer the scan keeps the
 * three-pane panel unchanged.
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
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
  await page.goto(harness)
  await page.addScriptTag({ path: resolve(DIR, 'client.js') })
  await page.addScriptTag({ path: resolve(DIR, 'mock-rpc.mjs') })
  const snapshotFails = options.snapshotFails === true
  const snap = options.dirty === true
    ? { ...SNAP, dirty: true, modified: 2, changes: [{ path: 'a.txt', status: 'M', side: 'worktree' }] }
    : SNAP
  const out = await page.evaluate(async ({ snap, repos: listed, action, snapshotFails }) => {
    const React = window.React
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
      // repository of its own, only nested ones.
      if (snapshotFails && endpoint === 'gitPanel/snapshot') {
        return { ok: true, value: { ok: false, error: { code: 'not-a-git-repo', cwd: '/mock/workspace' } } }
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
      if (!row) throw new Error('no repository row ' + name + ' in ' + selector)
      row.click()
    }

    const observed = {
      tabs: tabLabels(),
      tabCount: document.querySelector('.gp-panel .gp-tabbar').getAttribute('data-tab-count'),
    }
    if (action === 'switch') {
      // A dirty checkout opens on Changes; the list lives in the overview.
      if (activeTabLabel() !== 'tab.overview') {
        clickTab('tab.overview')
        await wait(300)
      }
    }
    observed.activeTab = activeTabLabel()
    observed.inLeftColumn = listInLeftColumn()
    observed.rows = listRows()
    if (action !== 'switch') {
      // The standalone page (compact layout, non-checkout cwd) only exists when
      // the bar carries a Repositories tab; read its cards from there.
      if (observed.tabs.includes('tab.repos')) {
        clickTab('tab.repos')
        await wait(250)
        observed.cards = cardRows()
        observed.activeTab = activeTabLabel()
      }
      return { observed, calls }
    }

    let mark = calls.length
    pickRow('.gp-repolist__item', 'site')
    await wait(600)
    observed.afterNested = { activeTab: activeTabLabel(), inLeftColumn: listInLeftColumn(), rows: listRows(), calls: calls.slice(mark) }
    mark = calls.length
    pickRow('.gp-repolist__item', 'fixture-repo')
    await wait(600)
    observed.afterBack = { activeTab: activeTabLabel(), rows: listRows(), calls: calls.slice(mark) }
    return { observed, calls }
  }, { snap, repos, action, snapshotFails })
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
    assert.equal(seen.afterNested.activeTab, 'tab.overview', 'picking a checkout stays on the overview')
    assert.equal(seen.afterNested.inLeftColumn, true, 'the list stays on screen while the panes reload')
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
// repository: there is no overview to dock under, so the list stays a page of
// its own and leads the bar.
{
  const { out, errors } = await mount([NESTED_REPO], 'inspect', { snapshotFails: true })
  try {
    assert.equal(out.error, undefined, 'the panel mounted')
    const seen = out.observed
    assert.deepEqual(seen.tabs, ['tab.repos', 'tab.files'], 'without an overview the list is a page')
    assert.equal(seen.inLeftColumn, false, 'and it is not in a column')
    assert.equal(seen.activeTab, 'tab.repos', 'the tab opens on the picker')
    assert.deepEqual(seen.cards, [
      { name: 'repo.root', path: '', active: true, current: 'true' },
      { name: 'site', path: '', active: false, current: null },
    ], 'the workspace root leads as the way back, then the one checkout')
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
