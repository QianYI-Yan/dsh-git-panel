/**
 * Review capture: the two-step discard hint. The arming press raises the
 * "click again" wording on the spot (no hover), and the next press elsewhere
 * dismisses it. Run setup.mjs first.
 */
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const DIR = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(DIR, '../../docs/local/review')
const harness = 'file://' + resolve(DIR, 'harness.html')
const THEME = `body{margin:0;font:13px system-ui,sans-serif;
--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#fff;
--dsw-alias-bg-layer-3:#fff;--dsw-alias-bg-module-platform:#e9eaec;
--dsw-alias-border-l1:#0000000a;--dsw-alias-border-l2:#0000001a;
--dsw-alias-interactive-bg-hover:#2631480f;--dsw-alias-label-primary:#0f1115;
--dsw-alias-label-secondary:#61666b;--dsw-alias-label-tertiary:#81858c;
--dsw-alias-state-business-primary:#4176e6;--dsw-alias-state-error-primary:#ec1313;
--dsw-alias-state-success-primary:#22c55e;--dsw-alias-state-warn-primary:#f59e0b;
background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
#panel{border:0!important}`

const SNAPSHOT = {
  root: 'fixture-repo', branch: 'main', head: 'de54fc0', unborn: false, dirty: true,
  staged: 0, modified: 2, untracked: 0, ahead: 0, behind: 0, hasUpstream: true,
  remote: null, lastCommit: null,
  changes: [
    { path: 'src/client/ChangesTab.tsx', status: 'modified', staged: false, isDirectory: false },
    { path: 'a.txt', status: 'modified', staged: false, isDirectory: false },
  ],
  stats: { fileCount: 2, staged: 0, modified: 2, untracked: 0, insertions: 4, deletions: 2, lastChangeAt: Date.now(), headCommittedAt: null },
  truncated: false, refreshIntervalMs: 0, showInputPill: true, defaultDiffView: 'unified', checkedAt: Date.now(),
}

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
await page.goto(harness)
await page.addStyleTag({ content: THEME })
for (const file of ['client.js', 'mock-rpc.mjs']) await page.addScriptTag({ path: resolve(DIR, file) })

await page.evaluate((snapshot) => {
  const panel = document.getElementById('panel')
  panel.style.width = '360px'
  panel.style.height = '600px'
  const { fixture, connection } = window.createGitPanelMock(snapshot)
  window.__gpFixture = fixture
  const registered = {}
  const dictionaries = {}
  const ctx = {
    get: (key) => key === 'connection' ? connection : undefined,
    effect: (cb) => cb(),
    on: () => () => {},
    inject: (_deps, cb) => cb(ctx),
    slots: {
      inject: (_name, provider) => provider(),
      register: (reg, component) => { registered[reg.name] = component; return () => {} },
    },
    locale: {
      register: (ns, dict) => { dictionaries[ns] = dict },
      bind: (ns) => (key, params) => {
        const text = dictionaries[ns]?.zh[key] ?? key
        return params === undefined ? text : text.replace(/\{(\w+)\}/g, (m, k) => k in params ? String(params[k]) : m)
      },
    },
  }
  window.__getLoaded().apply(ctx)
  window.ReactDOM.createRoot(panel).render(registered['conversation.view']({ sessionId: 'tip-session' }))
}, SNAPSHOT)

await page.locator('[role="tab"]').nth(1).click()
await page.locator('.gp-file-row').first().waitFor()
await page.waitForTimeout(300)

// Hover the row (not the button) so the row actions are visible the way they
// are on a touch device; the pointer never touches the discard button, so any
// hint that appears can only come from the press itself.
await page.locator('.gp-file-row').first().hover()
await page.waitForTimeout(200)
const report = { tipBefore: await page.locator('.gp-tip').count() }
const discard = page.locator('.gp-file-row').first()
  .locator('button[aria-label="放弃更改"], button[aria-label="再次点击以确认放弃"]')
await discard.evaluate((el) => el.click())
await page.waitForTimeout(250)
report.armedAria = await discard.getAttribute('aria-label')
report.tipText = await page.locator('.gp-tip').textContent()
report.tipOnBody = await page.locator('.gp-tip').evaluate((tip) => tip.parentElement === document.body)
// Compact layout centres the bubble on the row icon it explains.
report.centering = await page.evaluate(() => {
  const tip = document.querySelector('.gp-tip')
  const btn = document.querySelector('.gp-file-row button[aria-label="再次点击以确认放弃"]')
  const t = tip.getBoundingClientRect()
  const b = btn.getBoundingClientRect()
  return {
    centered: tip.classList.contains('gp-tip--center'),
    tipCenter: Math.round(t.left + t.width / 2),
    buttonCenter: Math.round(b.left + b.width / 2),
    delta: Math.round((t.left + t.width / 2) - (b.left + b.width / 2)),
    insideViewport: t.left >= 0 && t.right <= window.innerWidth,
  }
})
// The bubble anchors at the button's left edge in the row's right corner, so the
// clip has to reach past the panel edge to show it whole.
const clip = await page.evaluate(() => {
  const list = document.querySelector('.gp-changes__left') ?? document.querySelector('.gp-changes')
  const tip = document.querySelector('.gp-tip')
  const b = list.getBoundingClientRect()
  const t = tip.getBoundingClientRect()
  const right = Math.max(b.right, t.right) + 8
  return { x: 0, y: b.y, width: right, height: Math.min(b.height, 210) }
})
await page.screenshot({ path: resolve(OUT, 'discard-armed-tip.png'), clip })

await page.mouse.click(880, 680)
await page.waitForTimeout(250)
report.tipAfterOutsidePress = await page.locator('.gp-tip').count()
report.actionsAfterOutsidePress = await page.evaluate(() => window.__gpFixture.actions.length)
await discard.evaluate((el) => el.click())
await page.waitForTimeout(300)
report.actionsAfterSecondPress = await page.evaluate(() => window.__gpFixture.actions.map((a) => a.kind))
report.tipAfterSecondPress = await page.locator('.gp-tip').count()

console.log(JSON.stringify(report, null, 2))
if (errors.length) console.log('CONSOLE ERRORS:', errors)
await browser.close()
