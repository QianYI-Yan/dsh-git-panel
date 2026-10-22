/**
 * Tight stacked sidebar (≤ STACKED_TIGHT_BP): the top band's left column is a
 * drawer over the history.
 *
 * At 420 (stacked, not tight) the column stays inline — no drawer, no toolbar
 * toggle. At 320 (tight) it collapses by default: inert, retracted a full
 * width to the left so the history takes the whole band, and the toolbar's
 * branch toggle reports aria-expanded=false with an aria-controls that resolves
 * to it. Opening it slides the column in above the backdrop with focus on the
 * close button; Escape, a click on the blank band and the close button each
 * dismiss it — while a confirm dialog is up, one Escape closes only the
 * dialog. Widening back re-attaches the column inline.
 *
 * Isolated file:// harness, no dsh server. Requires test/e2e/setup.mjs first.
 */
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const E2E = dirname(fileURLToPath(import.meta.url))
const harness = 'file://' + resolve(E2E, 'harness.html')
const REVIEW_DIR = resolve(E2E, '../../docs/local/review')
const THEME = `body{margin:0;font:13px system-ui,sans-serif;
  --dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#f7f8fa;
  --dsw-alias-bg-layer-3:#fff;--dsw-alias-bg-module-platform:#e9eaec;
  --dsw-alias-border-l1:#0000000a;--dsw-alias-border-l2:#0000001a;
  --dsw-alias-interactive-bg-hover:#2631480f;--dsw-alias-label-primary:#0f1115;
  --dsw-alias-label-secondary:#61666b;--dsw-alias-label-tertiary:#81858c;
  --dsw-alias-label-caption:#81858c;
  --dsw-alias-state-business-primary:#4176e6;--dsw-alias-state-error-primary:#ec1313;
  --dsw-alias-state-success-primary:#22c55e;--dsw-alias-state-warn-primary:#f59e0b;
  background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
  #panel{border:0!important;box-sizing:border-box}`

// Clean worktree: the panel lands on the overview tab by itself.
const SNAP = {
  root: 'fixture-repo', branch: 'main', head: 'ba78eb4', unborn: false, dirty: false,
  staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0, hasUpstream: true,
  remote: { name: 'origin', webUrl: 'https://github.com/example/repo', hostKind: 'github' },
  lastCommit: null, changes: [],
  stats: { fileCount: 0, staged: 0, modified: 0, untracked: 0, insertions: 0, deletions: 0, lastChangeAt: null, headCommittedAt: null },
  truncated: false, refreshIntervalMs: 0, showInputPill: true, suggestEnabled: true,
  defaultDiffView: 'unified', checkedAt: Date.now(),
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 480, height: 980 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))

await page.goto(harness)
await page.addStyleTag({ content: THEME })
await page.addScriptTag({ path: resolve(E2E, 'mock-rpc.mjs') })
await page.addScriptTag({ path: resolve(E2E, 'client.js') })

// The seat boots at whatever width the caller asks: a panel can mount straight
// into the tight tier (no wider frame first), which is the only way to observe
// the drawer's default — a pass through a non-tight width resets the overlay
// state anyway (OverviewTab closes it when tight turns false).
const boot = (width) => page.evaluate(async ({ snap, w }) => {
  const { connection } = window.createGitPanelMock(snap)
  const ctl = { registered: {}, sidebarTypes: [], openedTabs: [] }
  window.__ctl = ctl
  const settings = {
    view: { namespaces: [{ ns: 'gitPanel', schema: { dict: { showInputPill: {}, placement: {} } }, value: { showInputPill: true, placement: 'sidebar' } }] },
    status: 'ready',
  }
  const configForms = {
    describe: () => ({ getSnapshot: () => settings, subscribe: () => () => {}, ensure: async () => {} }),
    get: () => ({
      getSnapshot: () => ({ status: 'ready', value: { showInputPill: true, placement: 'sidebar' }, revision: 0, writable: true }),
      subscribe: () => () => {},
      set: async () => true,
    }),
  }
  const sidebarTabs = {
    register: (definition) => {
      ctl.sidebarTypes.push(definition)
      return () => { const at = ctl.sidebarTypes.indexOf(definition); if (at !== -1) ctl.sidebarTypes.splice(at, 1) }
    },
  }
  const sidebarRight = { openTab: (kind) => { ctl.openedTabs.push(kind) } }

  const services = { connection, configForms, sidebarRightTabs: sidebarTabs, sidebarRight }
  const dictionaries = {}
  const ctx = {
    get: (key) => services[key],
    effect: (cb) => { try { cb() } catch { /* ignore */ } },
    on: () => () => {},
    inject: (_deps, cb) => cb(ctx),
    slots: {
      inject: (_name, provider) => provider(),
      register: (reg, component) => {
        const key = reg.key === undefined ? reg.name : `${reg.name}::${reg.key}`
        ctl.registered[key] = { reg, component }
        return () => { delete ctl.registered[key] }
      },
    },
    locale: {
      register: (ns, dict) => { dictionaries[ns] = dict; return () => { delete dictionaries[ns] } },
      bind: (ns) => (key, params) => {
        const text = dictionaries[ns]?.zh?.[key] ?? dictionaries[ns]?.en?.[key] ?? key
        return params === undefined ? text : text.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m))
      },
    },
  }
  window.__getLoaded().apply(ctx)
  await new Promise((r) => setTimeout(r, 400))

  const entry = ctl.registered['sidebar.right.pane.tab::@xbzbing/dsh-git-panel']
  if (entry === undefined) throw new Error('sidebar body seat did not register')
  const host = document.getElementById('panel')
  host.style.width = `${w}px`
  host.style.height = '900px'
  window.ReactDOM.createRoot(host).render(entry.component({
    sessionId: 'sess-1',
    useTabInfo: () => ({ tab: { visible: true } }),
    t: (key) => key,
  }))
  await new Promise((r) => setTimeout(r, 800))
}, { snap: SNAP, w: width })
await boot(420)

const out = {}
const probe = () => page.evaluate(() => {
  const drawer = document.querySelector('.gp-drawer')
  const toggle = document.querySelector('.gp-toolbar__branches')
  const backdrop = document.querySelector('.gp-drawer-backdrop')
  const top = document.querySelector('.gp-overview__top')
  const history = document.querySelector('.gp-history')
  const inline = document.querySelector('.gp-col--left:not(.gp-drawer)')
  const search = document.querySelector('.gp-search')
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }
  return {
    drawer: drawer === null ? null : {
      open: drawer.getAttribute('data-open'),
      inert: drawer.hasAttribute('inert'),
      transform: getComputedStyle(drawer).transform,
      boxShadow: getComputedStyle(drawer).boxShadow,
      box: box(drawer),
      rows: drawer.querySelectorAll('.gp-branch-row').length,
      statusbar: drawer.querySelector('.gp-statusbar') !== null,
      repo: drawer.querySelector('a.gp-statusbar__repo') !== null,
    },
    toggle: toggle === null ? null : {
      expanded: toggle.getAttribute('aria-expanded'),
      focus: document.activeElement === toggle,
      box: box(toggle),
    },
    controlsResolve: toggle === null ? false : document.getElementById(toggle.getAttribute('aria-controls')) === drawer,
    closeFocus: document.activeElement !== null && document.activeElement.classList.contains('gp-drawer__close'),
    backdrop: backdrop === null ? null : box(backdrop),
    inline: inline === null ? null : { position: getComputedStyle(inline).position, rows: inline.querySelectorAll('.gp-branch-row').length },
    top: top === null ? null : box(top),
    history: history === null ? null : box(history),
    searchBox: search === null ? null : box(search),
    repoHref: (document.querySelector('.gp-col--left a.gp-statusbar__repo, .gp-drawer a.gp-statusbar__repo')?.getAttribute('href')) ?? null,
  }
})
const setWidth = async (w) => {
  await page.evaluate((width) => { document.getElementById('panel').style.width = `${width}px` }, w)
  await page.waitForTimeout(350)
}

// ── 420 (stacked, not tight): the column is inline — no drawer anywhere. ──
out.inline420 = await probe()
assert.equal(out.inline420.drawer, null, 'at 420 the left column is not a drawer')
assert.equal(out.inline420.toggle, null, 'at 420 there is no branch-drawer toggle')
assert.equal(out.inline420.backdrop, null, 'at 420 there is no drawer backdrop')
assert.ok(out.inline420.inline !== null, 'at 420 the left column renders inline')
assert.equal(out.inline420.inline.position, 'static', 'the inline column sits in the flex flow')
assert.ok(out.inline420.inline.rows > 0, `the branch list renders inline (${out.inline420.inline.rows} rows)`)
assert.equal(out.inline420.repoHref, 'https://github.com/example/repo', 'the inline status bar keeps the GitHub repo link')

// ── 320 (tight): collapsed by default, history takes the whole band. ──
await setWidth(320)
out.tight = await probe()
assert.ok(out.tight.drawer !== null, 'at 320 the left column becomes a drawer')
assert.equal(out.tight.drawer.open, 'false', 'the drawer is collapsed by default')
assert.equal(out.tight.drawer.inert, true, 'the collapsed drawer is inert')
assert.ok(out.tight.drawer.transform.startsWith('matrix(1, 0, 0, 1, -'), `the collapsed drawer is retracted a full width to the left (${out.tight.drawer.transform})`)
assert.equal(out.tight.inline, null, 'no inline column remains beside the history')
assert.equal(out.tight.backdrop, null, 'a collapsed drawer leaves no backdrop')
assert.ok(out.tight.drawer.rows > 0, `the branch list lives inside the drawer (${out.tight.drawer.rows} rows)`)
assert.equal(out.tight.drawer.statusbar, true, 'the status bar moved into the drawer')
assert.ok(out.tight.drawer.box.w >= 180 && out.tight.drawer.box.w <= 260, `the drawer is clamp(180px,72%,260px) wide (${out.tight.drawer.box.w}px)`)
// A retracted drawer sits flush against x=0, so any side shadow would leak a
// visible band over the history even while closed.
assert.equal(out.tight.drawer.boxShadow, 'none', 'the collapsed drawer paints no shadow either')
assert.equal(out.tight.toggle.expanded, 'false', 'the toggle reports the collapsed state')
assert.equal(out.tight.controlsResolve, true, "the toggle's aria-controls resolves to the drawer")
assert.ok(Math.abs(out.tight.history.w - out.tight.top.w) <= 2, `the collapsed drawer leaves the history the whole band (${out.tight.history.w} vs ${out.tight.top.w}px)`)
// The toggle shares the toolbar's first row with the search box: the stacked
// search basis reserves the button's 28px + 6px gap, or the input's full-width
// basis would wrap it and strand the button on a row of its own.
const rowGap = Math.abs((out.tight.toggle.box.y + out.tight.toggle.box.h / 2) - (out.tight.searchBox.y + out.tight.searchBox.h / 2))
assert.ok(rowGap < 10, `the toggle and the search share the toolbar's first row (${rowGap}px apart)`)
mkdirSync(REVIEW_DIR, { recursive: true })
await page.locator('.gp-panel').screenshot({ path: resolve(REVIEW_DIR, 'branch-drawer-320-collapsed.png') })

// ── Open: slides in above the backdrop, focus lands on the close button. ──
await page.click('.gp-toolbar__branches')
await page.waitForTimeout(250)
out.open = await probe()
assert.equal(out.open.drawer.open, 'true', 'the toggle opens the drawer')
assert.equal(out.open.drawer.inert, false, 'the open drawer is interactive')
assert.equal(out.open.drawer.transform, 'none', "the open drawer sits flush at the band's left edge")
assert.equal(out.open.drawer.boxShadow, 'none', 'the drawer paints no side shadow over the history')
assert.ok(out.open.backdrop !== null, 'opening lays a backdrop over the band')
assert.ok(Math.abs(out.open.backdrop.w - out.open.top.w) <= 2 && Math.abs(out.open.backdrop.h - out.open.top.h) <= 2, 'the backdrop covers exactly the top band')
assert.equal(out.open.toggle.expanded, 'true', 'the toggle reports the open state')
assert.equal(out.open.closeFocus, true, "focus lands on the drawer's close button")
assert.ok(Math.abs(out.open.drawer.box.x - out.open.top.x) <= 2, "the open drawer aligns with the band's left edge")
assert.ok(Math.abs(out.open.history.w - out.open.top.w) <= 2, `the open drawer overlays the history instead of pushing it (${out.open.history.w} vs ${out.open.top.w}px)`)
assert.equal(out.open.drawer.statusbar, true, 'the drawer carries the status bar')
assert.equal(out.open.drawer.repo, false, 'the tight status bar drops the GitHub repo link (narrow-panel rule)')
await page.locator('.gp-panel').screenshot({ path: resolve(REVIEW_DIR, 'branch-drawer-320-open.png') })

// ── Escape dismisses it and returns focus to the toggle. ──
await page.keyboard.press('Escape')
await page.waitForTimeout(150)
out.escaped = await probe()
assert.equal(out.escaped.drawer.open, 'false', 'Escape closes the drawer')
assert.equal(out.escaped.drawer.boxShadow, 'none', 'the shadow does not come back when the drawer retracts')
assert.equal(out.escaped.backdrop, null, 'Escape removes the backdrop')
assert.equal(out.escaped.toggle.focus, true, 'focus returns to the toggle')

// ── Reopen; a click on the blank band dismisses it. ──
await page.click('.gp-toolbar__branches')
await page.waitForTimeout(250)
const band = await page.locator('.gp-drawer-backdrop').boundingBox()
assert.ok(band !== null, 'the backdrop is measurable for the click')
await page.locator('.gp-drawer-backdrop').click({ position: { x: band.width - 16, y: 80 } })
await page.waitForTimeout(150)
out.scrimClick = await probe()
assert.equal(out.scrimClick.drawer.open, 'false', 'a click on the blank band closes the drawer')
assert.equal(out.scrimClick.backdrop, null, 'the backdrop goes with it')

// ── Reopen; the drawer's own close button dismisses it. ──
await page.click('.gp-toolbar__branches')
await page.waitForTimeout(250)
await page.click('.gp-drawer__close')
await page.waitForTimeout(150)
out.closedByButton = await probe()
assert.equal(out.closedByButton.drawer.open, 'false', 'the close button closes the drawer')
assert.equal(out.closedByButton.toggle.focus, true, 'focus returns to the toggle again')

// ── A confirm dialog above the drawer owns the first Escape. ──
await page.click('.gp-toolbar__branches')
await page.waitForTimeout(250)
await page.hover('.gp-drawer .gp-branch-row[title="feature"]')
await page.click('.gp-branch-row[title="feature"] .gp-branch-row__switch')
await page.waitForSelector('.gp-modal-backdrop', { timeout: 5000 })
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
out.guard = await probe()
assert.equal(await page.$('.gp-modal-backdrop'), null, 'the first Escape closes the confirm dialog')
assert.equal(out.guard.drawer.open, 'true', "one keypress never dismisses the drawer together with the dialog")
await page.keyboard.press('Escape')
await page.waitForTimeout(150)
out.guardNext = await probe()
assert.equal(out.guardNext.drawer.open, 'false', 'the next Escape, with no dialog up, closes the drawer')

// ── Widening past the breakpoint re-attaches the column inline. ──
await setWidth(420)
out.recovered = await probe()
assert.equal(out.recovered.drawer, null, 'widening drops the drawer markup')
assert.equal(out.recovered.toggle, null, 'the toolbar toggle goes with it')
assert.equal(out.recovered.backdrop, null, 'no backdrop survives the widening')
assert.ok(out.recovered.inline !== null, 'the column renders inline again')
assert.equal(out.recovered.inline.position, 'static', 'and back in the flex flow')
assert.equal(out.recovered.repoHref, 'https://github.com/example/repo', 'the widened status bar keeps the GitHub repo link')

// ── Booting straight into the tight tier: collapsed on the FIRST mount — the
//    default itself, not a reset inherited from a wider frame. ──
await page.reload()
await page.addStyleTag({ content: THEME })
await page.addScriptTag({ path: resolve(E2E, 'mock-rpc.mjs') })
await page.addScriptTag({ path: resolve(E2E, 'client.js') })
await boot(320)
out.bootTight = await probe()
assert.ok(out.bootTight.drawer !== null, 'a panel that boots at a tight width renders the drawer')
assert.equal(out.bootTight.drawer.open, 'false', 'a drawer mounting at a tight width is collapsed by default')
assert.equal(out.bootTight.drawer.boxShadow, 'none', 'the first mount carries no shadow either')
assert.equal(out.bootTight.drawer.inert, true, 'and inert on its very first mount')
assert.ok(out.bootTight.toggle !== null, 'the toolbar toggle mounts with it')
assert.equal(out.bootTight.toggle.expanded, 'false', 'the toggle reports the collapsed state on the first mount too')

assert.deepEqual(errors, [], 'no console errors')
console.log('e2e/stacked-branch-drawer: all assertions passed', JSON.stringify(out))
await browser.close()
