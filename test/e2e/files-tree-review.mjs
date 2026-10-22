/**
 * Review capture: the Files tree now uses the official closed/open folder
 * glyphs (no chevron) — a collapsed directory shows the closed folder, an
 * expanded one the open folder. Run setup.mjs first.
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

const SNAP = {
  root: 'fixture-repo', branch: 'main', head: '44638f7', unborn: false, dirty: false,
  staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0, hasUpstream: true,
  remote: { name: 'origin', webUrl: 'https://github.com/example/repo', hostKind: 'github' },
  lastCommit: null, changes: [],
  stats: { fileCount: 0, staged: 0, modified: 0, untracked: 0, insertions: 0, deletions: 0, lastChangeAt: null, headCommittedAt: null },
  truncated: false, refreshIntervalMs: 0, showInputPill: true,
  defaultDiffView: 'unified', checkedAt: Date.now(),
}

const TREE = {
  '': [['docs', true], ['src', true], ['README.md', false], ['a.txt', false]],
  docs: [['assets', true], ['local', true]],
  // Declared empty on purpose: the review shot shows the empty-directory hint
  // under an expanded folder, so the folder must not borrow the fallback.
  'docs/assets': [],
  'docs/local': [['bak', true], ['banner', true], ['review', true], ['tasks', true]],
  src: [['index.ts', false]],
}

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
await page.goto(harness)
await page.addStyleTag({ content: THEME })
await page.addScriptTag({ path: resolve(DIR, 'client.js') })

await page.evaluate(async ({ snap, tree }) => {
  const entry = window.__getLoaded()
  const connection = {
    rpc: {
      call: async (_c, endpoint, payload) => {
        const request = payload && payload.args && payload.args.request
        if (endpoint === 'gitPanel/snapshot') return { ok: true, value: { ok: true, value: snap } }
        if (endpoint === 'gitPanel/query') {
          const q = request.query
          if (q.kind === 'branches') return { ok: true, value: { ok: true, value: { kind: 'branches', current: 'main', defaultBranch: null, local: [{ name: 'main', shortHash: '44638f7' }], remote: [] } } }
          if (q.kind === 'tags') return { ok: true, value: { ok: true, value: { kind: 'tags', tags: [] } } }
          if (q.kind === 'authors') return { ok: true, value: { ok: true, value: { kind: 'authors', authors: [] } } }
          if (q.kind === 'history') return { ok: true, value: { ok: true, value: { kind: 'history', total: 0, commits: [] } } }
          if (q.kind === 'dir-list') {
            const entries = (tree[q.path] || []).map(([name, dir]) => dir ? { name, dir } : { name, dir, size: 12 })
            return { ok: true, value: { ok: true, value: { kind: 'dir-list', path: q.path, truncated: false, entries } } }
          }
          if (q.kind === 'file-content') return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'text', content: 'const x = 1\n', lines: 1 } } }
          if (q.kind === 'last-commit-message') return { ok: true, value: { ok: true, value: { kind: 'last-commit-message', message: '' } } }
        }
        if (endpoint === 'gitPanel/run') return { ok: true, value: { ok: true, snapshot: snap } }
        if (endpoint === 'gitPanel/version') return { ok: true, value: { current: '0.1.0', repositoryUrl: 'https://github.com/xbzbing/dsh-git-panel', updateAvailable: false, checkedRemote: false } }
        return { ok: false, error: { code: 'git-error', message: 'unhandled ' + endpoint } }
      },
    },
  }
  const registered = {}
  const dictionaries = {}
  const ctx = {
    get: (k) => ({ connection })[k],
    effect: (cb) => { try { cb() } catch { /* ignore */ } },
    on: () => () => {},
    inject: (_d, cb) => cb(ctx),
    slots: { inject: (_n, p) => p(), register: (reg, component) => { registered[reg.name] = { reg, component }; return () => {} } },
    locale: {
      register: (ns, dict) => { dictionaries[ns] = dict },
      bind: (ns) => (key, params) => {
        const text = dictionaries[ns]?.zh?.[key] ?? key
        return params === undefined ? text : text.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m))
      },
    },
  }
  entry.apply(ctx)
  await new Promise((r) => setTimeout(r, 500))
  const panelHost = document.getElementById('panel')
  panelHost.style.width = '390px'
  window.ReactDOM.createRoot(panelHost).render(registered['conversation.view'].component({ sessionId: 'sess-1' }))
  await new Promise((r) => setTimeout(r, 700))
  window.__panelHost = panelHost
  const tab = [...document.querySelectorAll('.gp-tabbar [role="tab"]')].find((t) => (t.textContent || '').includes('文件') || (t.textContent || '').includes('tab.files'))
  tab?.click()
  await new Promise((r) => setTimeout(r, 600))
  window.__expand = async (name) => {
    const row = [...document.querySelectorAll('.gp-files__tree .gp-files__entry--dir')]
      .find((r) => (r.getAttribute('aria-label') || '').trim() === name)
    row?.click()
    await new Promise((r) => setTimeout(r, 350))
  }
  window.__treeIcons = () => [...document.querySelectorAll('.gp-files__tree svg[data-folder]')]
    .map((s) => (s.getAttribute('data-folder') === 'open' ? 'open' : 'closed'))
}, { snap: SNAP, tree: TREE })

const report = {}
for (const width of [390, 304]) {
  await page.evaluate((w) => { window.__panelHost.style.width = w + 'px' }, width)
  await page.waitForTimeout(250)
  // docs and local expanded, like the official browser's open-directory state.
  const tree = page.locator('.gp-files__tree-wrap')
  await page.evaluate(async () => { await window.__expand('docs'); await window.__expand('local') })
  report[width] = { icons: await page.evaluate(() => window.__treeIcons()) }
  await tree.screenshot({ path: resolve(OUT, `files-tree-${width}.png`) })
  // Collapse again for the next width so expansion state starts from closed.
  await page.evaluate(async () => { await window.__expand('local'); await window.__expand('docs') })
}

// The empty directory now says so: expand docs → assets (a dir whose listing
// resolves to nothing) and capture the hint row indented under it.
await page.evaluate((w) => { window.__panelHost.style.width = w + 'px' }, 390)
await page.waitForTimeout(250)
await page.evaluate(async () => { await window.__expand('docs'); await window.__expand('assets') })
// Match on the hint's own text, not "the first muted row": a loading row would
// otherwise be recorded (and screenshotted) as if it were the empty hint.
report.emptyDir = await page.evaluate(() => [...document.querySelectorAll('.gp-files__tree .gp-tree-row--muted')]
  .map((r) => (r.textContent || '').trim())
  .find((text) => text === 'files.emptyDir') ?? null)
await page.locator('.gp-files__tree-wrap').screenshot({ path: resolve(OUT, 'files-tree-empty-dir.png') })

console.log(JSON.stringify(report, null, 2))
if (errors.length) console.log('CONSOLE ERRORS:', errors)
await browser.close()
