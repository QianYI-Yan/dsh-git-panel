/**
 * E2E: the repository switcher in the tab bar.
 *
 * A workspace may hold nested repositories beside its own checkout (issue
 * #83). The bar must stay unchanged while only one repository is visible, list
 * the others once there are several, and carry the picked repository on every
 * repository-scoped request — the panes themselves never learn about it.
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

// A clean checkout: the switcher is what this runner measures, so the panes
// stay quiet (no expanded lists, no diffs, no image fetches).
const SNAP = {
  root: 'fixture-repo', branch: 'main', head: 'de54fc0', unborn: false, dirty: false,
  staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0, hasUpstream: true,
  remote: null, lastCommit: null, changes: [],
  stats: { fileCount: 0, staged: 0, modified: 0, untracked: 0, insertions: 0, deletions: 0, lastChangeAt: null, headCommittedAt: null },
  truncated: false, refreshIntervalMs: 0, showInputPill: true, defaultDiffView: 'unified', checkedAt: Date.now(),
}

const WORKSPACE_REPO = { path: '', root: 'fixture-repo', name: 'fixture-repo', kind: 'workspace' }
const NESTED_REPO = { path: 'site', root: 'fixture-repo/site', name: 'site', kind: 'nested' }

const browser = await chromium.launch()

/**
 * Mount the panel in a fresh page. `action` drives the switcher inside the
 * page ('none' only observes); the page hands back observations so the
 * assertions stay on this side of the RPC.
 */
async function mount(repos, action) {
  const page = await browser.newPage()
  const errors = []
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
  await page.goto(harness)
  await page.addScriptTag({ path: resolve(DIR, 'client.js') })
  await page.addScriptTag({ path: resolve(DIR, 'mock-rpc.mjs') })
  const out = await page.evaluate(async ({ snap, repos: listed, action }) => {
    const React = window.React
    const { fixture, connection } = window.createGitPanelMock(snap)
    fixture.repos = listed
    // Every repository-scoped request, so the test can prove the pick reaches
    // the wire rather than only the trigger's label. The client captures the
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

    const switcher = () => document.querySelector('.gp-panel .gp-tabbar__repo')
    const trigger = () => document.querySelector('.gp-panel .gp-tabbar__repo .gp-select-trigger')
    const menuItems = () => [...document.querySelectorAll('.dsh-menu-list [role="menuitem"]')]
    const labels = () => menuItems().map((node) => (node.textContent || '').trim())
    const pick = (label) => {
      const item = menuItems().find((node) => (node.textContent || '').trim() === label)
      if (!item) throw new Error('no menu item ' + label + ' in ' + labels().join('|'))
      item.click()
    }
    const observed = { switcher: switcher() !== null, label: trigger() ? trigger().textContent : null }
    if (action !== 'switch' || !observed.switcher) return { observed, calls }

    trigger().click()
    await wait(120)
    observed.expanded = trigger().getAttribute('aria-expanded')
    observed.menu = labels()
    observed.selectedInMenu = menuItems().filter((node) => node.getAttribute('aria-checked') === 'true').map((node) => (node.textContent || '').trim())
    let mark = calls.length
    pick('site')
    await wait(600)
    observed.afterNested = {
      label: trigger() ? trigger().textContent : null,
      menuClosed: menuItems().length === 0,
      calls: calls.slice(mark),
    }
    // Back to the workspace's own checkout: the empty path is the default, so
    // the switcher must return to the workspace name and drop the tag again.
    trigger().click()
    await wait(120)
    mark = calls.length
    pick('fixture-repo')
    await wait(600)
    observed.afterBack = {
      label: trigger() ? trigger().textContent : null,
      calls: calls.slice(mark),
    }
    const body = (document.getElementById('panel') || document.body).textContent
    return { observed, calls, body }
  }, { snap: SNAP, repos, action })
  await page.close()
  return { out, errors }
}

const failures = []

// 1. A lone repository: the bar is exactly what it always was.
{
  const { out, errors } = await mount([WORKSPACE_REPO], 'none')
  try {
    assert.equal(out.error, undefined, 'the panel mounted')
    assert.equal(out.observed.switcher, false, 'a single repository shows no switcher')
    assert.ok(out.calls.length > 0, 'the panel still asked for a snapshot')
    assert.ok(out.calls.every((call) => call.repo === ''), 'a lone repository never tags requests')
    assert.deepEqual(errors, [], 'no page errors: ' + JSON.stringify(errors))
  } catch (error) {
    console.error('single-repo observation: ' + JSON.stringify({ observed: out.observed, calls: out.calls, errors, body: out.body }))
    failures.push(error)
  }
}

// 2. A workspace plus a nested checkout: switch out and back.
{
  const { out, errors } = await mount([WORKSPACE_REPO, NESTED_REPO], 'switch')
  try {
    assert.equal(out.error, undefined, 'the panel mounted')
    const seen = out.observed
    assert.equal(seen.switcher, true, 'two repositories show the switcher')
    assert.equal(seen.label, 'fixture-repo', 'the trigger names the workspace checkout by default')
    assert.equal(seen.expanded, 'true', 'opening the menu marks the trigger expanded')
    assert.deepEqual(seen.menu, ['fixture-repo', 'site'], 'the menu lists every repository once')
    assert.deepEqual(seen.selectedInMenu, ['fixture-repo'], 'the workspace checkout starts selected')
    assert.equal(seen.afterNested.label, 'site', 'picking a repository moves the trigger')
    assert.equal(seen.afterNested.menuClosed, true, 'picking a repository closes the menu')
    // `repo-list` is the one query that spans the whole workspace — it has to
    // stay untagged, or the switcher could not offer the repositories it is
    // meant to switch between.
    const scoped = (calls) => calls.filter((call) => call.kind !== 'repo-list')
    const nestedCalls = seen.afterNested.calls
    assert.ok(nestedCalls.some((call) => call.endpoint === 'gitPanel/snapshot'), 'the switch refetched a snapshot')
    assert.ok(nestedCalls.length >= scoped(nestedCalls).length + 1, 'the workspace listing was re-read after the switch')
    assert.ok(scoped(nestedCalls).every((call) => call.repo === 'site'), 'every repository-scoped request carries the picked repository: ' + JSON.stringify(nestedCalls))
    assert.equal(seen.afterBack.label, 'fixture-repo', 'switching back restores the workspace name')
    const backCalls = seen.afterBack.calls
    assert.ok(backCalls.some((call) => call.endpoint === 'gitPanel/snapshot'), 'switching back refetched a snapshot')
    assert.ok(scoped(backCalls).every((call) => call.repo === ''), 'the workspace checkout sends no tag: ' + JSON.stringify(backCalls))
    assert.deepEqual(errors, [], 'no page errors: ' + JSON.stringify(errors))
  } catch (error) {
    console.error('switch observation: ' + JSON.stringify({ observed: out.observed, errors, body: out.body }))
    failures.push(error)
  }
}

await browser.close()
if (failures.length > 0) {
  for (const failure of failures) console.error(failure)
  process.exit(1)
}
console.log('repo-switcher: ok')
