/**
 * E2E: the Repositories tab and the checkout it selects.
 *
 * A workspace may hold nested repositories beside its own checkout (issue
 * #83). The bar gains a leading Repositories tab that lists every checkout —
 * name, relative path, and for the checked one its branch and pending-change
 * count — and carrying the picked repository on every repository-scoped
 * request; the panes themselves never learn about it. A host that cannot
 * answer the scan keeps the three-pane panel unchanged.
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

// A clean checkout: the tab is what this runner measures, so the panes stay
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
    const repoRows = () => [...document.querySelectorAll('.gp-panel .gp-repos__item')].map((node) => ({
      name: (node.querySelector('.gp-repos__name') || { textContent: '' }).textContent.trim(),
      path: (node.querySelector('.gp-repos__path') || { textContent: '' }).textContent.trim(),
      active: node.classList.contains('gp-repos__item--active'),
      current: node.getAttribute('aria-current'),
      branch: (node.querySelector('.gp-repos__branch') || { textContent: '' }).textContent.trim(),
      count: (node.querySelector('.gp-repos__count') || { textContent: '' }).textContent.trim(),
    }))
    const pickRepo = (name) => {
      const row = [...document.querySelectorAll('.gp-panel .gp-repos__item')]
        .find((node) => (node.querySelector('.gp-repos__name') || { textContent: '' }).textContent.trim() === name)
      if (!row) throw new Error('no repository row ' + name)
      row.click()
    }

    const observed = { tabs: tabLabels(), tabCount: document.querySelector('.gp-panel .gp-tabbar').getAttribute('data-tab-count') }
    if (!observed.tabs.includes('tab.repos')) return { observed, calls }

    clickTab('tab.repos')
    await wait(250)
    observed.activeTab = activeTabLabel()
    observed.rows = repoRows()
    if (action !== 'switch') return { observed, calls }

    let mark = calls.length
    pickRepo('site')
    await wait(600)
    observed.afterNested = { activeTab: activeTabLabel(), calls: calls.slice(mark) }
    // Back to the workspace's own checkout: the empty path is the default, so
    // the tag has to disappear again while the list keeps both rows.
    clickTab('tab.repos')
    await wait(250)
    observed.rowsAfterSwitch = repoRows()
    mark = calls.length
    pickRepo('fixture-repo')
    await wait(600)
    observed.afterBack = { activeTab: activeTabLabel(), calls: calls.slice(mark) }
    return { observed, calls }
  }, { snap, repos, action, snapshotFails })
  await page.close()
  return { out, errors }
}

const failures = []

// 1. A host that cannot answer the scan: the panel keeps its three panes and
// never tags a request.
{
  const { out, errors } = await mount([], 'inspect')
  try {
    assert.equal(out.error, undefined, 'the panel mounted')
    assert.deepEqual(out.observed.tabs, ['tab.overview', 'tab.changes', 'tab.files'], 'no scan result means no Repositories tab')
    assert.equal(out.observed.tabCount, '3', 'the bar reports its tab count for the compact indicator')
    assert.ok(out.calls.length > 0, 'the panel still asked for a snapshot')
    assert.ok(out.calls.every((call) => call.repo === ''), 'a single checkout never tags requests')
    assert.deepEqual(errors, [], 'no page errors: ' + JSON.stringify(errors))
  } catch (error) {
    console.error('scan-less observation: ' + JSON.stringify({ observed: out.observed, calls: out.calls, errors }))
    failures.push(error)
  }
}

// 2. A lone checkout: the tab exists so its path and pending work stay
// readable, but the picker has nothing to switch between.
{
  const { out, errors } = await mount([WORKSPACE_REPO], 'inspect', { dirty: true })
  try {
    assert.equal(out.error, undefined, 'the panel mounted')
    const seen = out.observed
    assert.deepEqual(seen.tabs, ['tab.repos', 'tab.overview', 'tab.changes', 'tab.files'], 'the Repositories tab leads the bar')
    assert.equal(seen.tabCount, '4')
    assert.equal(seen.activeTab, 'tab.repos', 'the tab opens on its own page')
    assert.deepEqual(seen.rows, [
      { name: 'fixture-repo', path: '', active: true, current: 'true', branch: 'main', count: '2' },
    ], 'the single checkout is listed with its branch and pending count')
    assert.ok(out.calls.every((call) => call.repo === ''), 'nothing is tagged while only one checkout exists')
    assert.deepEqual(errors, [], 'no page errors: ' + JSON.stringify(errors))
  } catch (error) {
    console.error('single-checkout observation: ' + JSON.stringify({ observed: out.observed, errors }))
    failures.push(error)
  }
}

// 3. A workspace plus a nested checkout: switch out and back.
{
  const { out, errors } = await mount([WORKSPACE_REPO, NESTED_REPO, DEEP_REPO], 'switch')
  try {
    assert.equal(out.error, undefined, 'the panel mounted')
    const seen = out.observed
    assert.deepEqual(seen.rows.map((row) => row.name), ['fixture-repo', 'site', 'web (apps/web)'], 'every checkout is listed')
    assert.deepEqual(seen.rows.map((row) => row.active), [true, false, false], 'the workspace checkout starts checked')
    assert.equal(seen.rows[1].path, '', 'a folder that names the checkout needs no second line')
    assert.equal(seen.rows[2].path, 'apps/web', 'a nested row carries its relative path')
    assert.equal(seen.afterNested.activeTab, 'tab.overview', 'picking a checkout lands on its Git view')
    // `repo-list` is the one query that spans the whole workspace — it has to
    // stay untagged, or the tab could not offer the checkouts it switches
    // between.
    const scoped = (calls) => calls.filter((call) => call.kind !== 'repo-list')
    const nestedCalls = seen.afterNested.calls
    assert.ok(nestedCalls.some((call) => call.endpoint === 'gitPanel/snapshot'), 'the switch refetched a snapshot')
    assert.ok(nestedCalls.length > scoped(nestedCalls).length, 'the workspace listing was re-read after the switch')
    assert.ok(scoped(nestedCalls).every((call) => call.repo === 'site'), 'every repository-scoped request carries the picked checkout: ' + JSON.stringify(nestedCalls))
    assert.deepEqual(seen.rowsAfterSwitch.map((row) => row.active), [false, true, false], 'the list marks the checkout the panes act on')
    assert.equal(seen.afterBack.activeTab, 'tab.overview', 'switching back lands on the workspace checkout again')
    const backCalls = seen.afterBack.calls
    assert.ok(backCalls.some((call) => call.endpoint === 'gitPanel/snapshot'), 'switching back refetched a snapshot')
    assert.ok(scoped(backCalls).every((call) => call.repo === ''), 'the workspace checkout sends no tag: ' + JSON.stringify(backCalls))
    assert.deepEqual(errors, [], 'no page errors: ' + JSON.stringify(errors))
  } catch (error) {
    console.error('switch observation: ' + JSON.stringify({ observed: out.observed, errors }))
    failures.push(error)
  }
}

// 4. A workspace directory that is not a checkout, holding a single nested
// repository: the Git panes only exist for that repository, so the tab has to
// appear anyway — and offer a way back to the session root.
{
  const { out, errors } = await mount([NESTED_REPO], 'inspect', { snapshotFails: true })
  try {
    assert.equal(out.error, undefined, 'the panel mounted')
    const seen = out.observed
    assert.deepEqual(seen.tabs, ['tab.repos', 'tab.files'], 'only the picker and the browser exist here')
    assert.equal(seen.activeTab, 'tab.repos', 'the picker is the entry point of a non-checkout workspace')
    assert.deepEqual(seen.rows.map((row) => row.name), ['repo.root', 'site'], 'the session root leads the nested checkout')
    assert.deepEqual(seen.rows.map((row) => row.active), [true, false], 'the session root starts checked')
    assert.equal(seen.rows[1].path, '', 'the folder name already is the whole path')
    // No snapshot means no HEAD at all: the checked row must not claim a
    // detached one just because the sample was refused.
    assert.deepEqual(seen.rows.map((row) => row.branch), ['', ''], 'a snapshot-less selection reports no HEAD')
    assert.deepEqual(errors, [], 'no page errors: ' + JSON.stringify(errors))
  } catch (error) {
    console.error('non-repo root observation: ' + JSON.stringify({ observed: out.observed, errors }))
    failures.push(error)
  }
}

await browser.close()
if (failures.length > 0) {
  for (const failure of failures) console.error(failure)
  process.exit(1)
}
console.log('repo-switcher: ok')
