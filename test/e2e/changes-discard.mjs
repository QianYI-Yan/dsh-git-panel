/**
 * E2E: the changes list's batch discard + the per-row hover hints (issue #40).
 *
 * (a) Checking two working-tree rows enables the toolbar's "discard selected"
 *     entry; its confirm dialog states the deduped file count (never a file
 *     list) and confirming sends one `{kind:'discard', paths}` carrying the
 *     working-tree paths only.
 * (b) A staged-only pick enables nothing (there is nothing to discard there);
 *     mixing it into a live selection adds the "not affected" line and still
 *     keeps its path out of the request.
 * (c) The two row icon buttons explain themselves through the shared fast
 *     tooltip (a `div.gp-tip.gp-tip--sb` portaled to body, ~140ms delay),
 *     including the armed "click again" wording, while `aria-label` keeps the
 *     short name and no native `title` is left behind.
 *
 * Unlike the older runners this harness binds the *real* zh dictionary, so the
 * assertions pin the user-visible copy (and the body's {count} interpolation)
 * rather than locale keys. Isolated file:// harness, no dsh server; run
 * test/e2e/setup.mjs first.
 */
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const DIR = dirname(fileURLToPath(import.meta.url))
const harness = 'file://' + resolve(DIR, 'harness.html')

const FIXTURE_ROOT = 'fixture-repo'

// dup.txt carries both sides (porcelain `MM`): picking its `:s` row must read as
// staged-only, picking its `:w` row must clear that, and the batch count must
// dedupe the file. s1.txt is index-only; w1.txt is working-tree only. del.txt is
// an index-side deletion (the row whose old discard button failed outright) and
// newdir is an untracked directory, which porcelain collapses into one entry.
const SNAP = {
  root: FIXTURE_ROOT, branch: 'main', head: 'de54fc0', unborn: false, dirty: true,
  staged: 3, modified: 2, untracked: 1, ahead: 0, behind: 0, hasUpstream: true,
  remote: null, lastCommit: null,
  changes: [
    { path: 'del.txt', status: 'deleted', staged: true, isDirectory: false },
    { path: 'dup.txt', status: 'modified', staged: true, isDirectory: false },
    { path: 'dup.txt', status: 'modified', staged: false, isDirectory: false },
    { path: 's1.txt', status: 'modified', staged: true, isDirectory: false },
    { path: 'w1.txt', status: 'modified', staged: false, isDirectory: false },
    { path: 'newdir', status: 'untracked', staged: false, isDirectory: true },
  ],
  stats: { fileCount: 6, staged: 3, modified: 2, untracked: 1, insertions: 5, deletions: 1, lastChangeAt: Date.now(), headCommittedAt: null },
  truncated: false, refreshIntervalMs: 0, showInputPill: true, defaultDiffView: 'unified', checkedAt: Date.now(),
}

const STAGE_GLYPH = '+'
const UNSTAGE_GLYPH = '\u2212'
const DISCARD_GLYPH = '\u21ba'

const browser = await chromium.launch()

/**
 * Mount the panel against the mock connection with the real zh dictionary bound
 * (the mock records every `run` action on `window.__gpFixture.actions`). A dirty
 * snapshot defaults to the changes sub-tab, so the toolbar is on screen once the
 * discard entry appears.
 */
async function openPanel(snap) {
  const page = await browser.newPage()
  const errors = []
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
  await page.goto(harness)
  await page.addScriptTag({ path: resolve(DIR, 'client.js') })
  await page.addScriptTag({ path: resolve(DIR, 'mock-rpc.mjs') })
  await page.evaluate(async (snapshot) => {
    const { fixture, connection } = window.createGitPanelMock(snapshot)
    window.__gpFixture = fixture
    const registered = {}
    const dictionaries = {}
    const interpolate = (raw, params) => params === undefined
      ? raw
      : raw.replace(/\{(\w+)\}/g, (m, key) => (key in params ? String(params[key]) : m))
    const ctx = {
      get: (k) => ({ connection })[k],
      effect: (cb) => { try { cb() } catch (e) { /* ignore */ } },
      on: (event, listener) => { if (event === 'connection/reset') fixture.resetConnection = listener; return () => {} },
      inject: (_deps, cb) => cb(ctx),
      slots: { inject: (_name, provider) => provider(), register: (reg, component) => { registered[reg.name] = { reg, component }; return () => {} } },
      // The registered zh/en dictionaries instead of a key-echoing stub: the
      // changes copy and its {count} params are what these assertions pin.
      locale: {
        register: (ns, dict) => { dictionaries[ns] = dict },
        bind: (ns) => (key, params) => {
          const raw = dictionaries[ns] && dictionaries[ns].zh[key]
          return raw === undefined ? key : interpolate(raw, params)
        },
      },
    }
    window.__getLoaded().apply(ctx)
    window.ReactDOM.createRoot(document.getElementById('panel')).render(registered['conversation.view'].component({ sessionId: 'sess-1' }))
    await new Promise((r) => setTimeout(r, 500))
  }, snap)
  await page.waitForSelector('.gp-changes__discard-picked', { timeout: 5000 })
  return { page, errors }
}

/** (a)+(b): toolbar entry, confirm dialog copy, and the request that lands. */
async function batchScenario() {
  const { page, errors } = await openPanel(SNAP)
  const out = await page.evaluate(async (glyphs) => {
    const result = {}
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const rows = () => [...document.querySelectorAll('.gp-file-row')]
    // A path can hold two rows; the first icon button's glyph names the side
    // (`+` working tree, `-` index) exactly like the ui shows it.
    const rowOf = (name, glyph) => rows().find((r) => (r.querySelector('.gp-tree-name')?.textContent ?? '') === name
      && (r.querySelector('.gp-file-row__actions .gp-icon-btn')?.textContent ?? '') === glyph) ?? null
    const pick = async (name, glyph) => {
      rowOf(name, glyph)?.querySelector('input.gp-check')?.click()
      await wait(60)
    }
    const picked = () => document.querySelector('.gp-changes__discard-picked')
    const confirmBtn = () => [...document.querySelectorAll('.gp-modal--sm .gp-modal__footer .gp-btn')]
      .find((b) => b.classList.contains('gp-btn--danger')) ?? null

    result.rows = rows().map((r) => `${r.querySelector('.gp-tree-name')?.textContent}:${r.querySelector('.gp-file-row__actions .gp-icon-btn')?.textContent}`)
    // Per-row action inventory: discard is a working-tree operation, so the
    // index-side rows must offer unstage only.
    result.rowActions = rows().map((r) => ({
      row: `${r.querySelector('.gp-tree-name')?.textContent}:${r.querySelector('.gp-file-row__actions .gp-icon-btn')?.textContent}`,
      labels: [...r.querySelectorAll('.gp-file-row__actions .gp-icon-btn')].map((b) => b.getAttribute('aria-label')),
    }))
    const toolbar = [...document.querySelector('.gp-toolbar').children]
    result.toolbar = toolbar.map((b) => b.textContent)
    // The new entry sits between "unstage all" and "stash changes".
    result.entryAfterUnstageAll = toolbar[2] === picked() && (toolbar[1].textContent ?? '').includes('全部取消暂存')
    result.entryBeforeStash = (toolbar[3].textContent ?? '').includes('贮藏')
    result.entryLabel = picked().textContent
    result.disabledEmpty = picked().disabled === true

    await pick('dup.txt', glyphs.unstage)
    result.disabledStagedOnly = picked().disabled === true
    await pick('dup.txt', glyphs.stage)
    await pick('w1.txt', glyphs.stage)
    result.enabledAfterPicks = picked().disabled === false

    picked().click()
    await wait(150)
    const modal = document.querySelector('.gp-modal--sm')
    result.modalShown = modal !== null
    result.modalPortaled = modal !== null && !document.getElementById('panel').contains(modal)
    result.modalTitle = modal?.querySelector('.gp-modal__path')?.textContent ?? null
    result.modalTexts = [...(modal?.querySelectorAll('.gp-modal__confirmtext') ?? [])].map((n) => n.textContent)
    const ok = confirmBtn()
    result.confirmLabel = ok?.textContent ?? null
    result.confirmDanger = ok?.classList.contains('gp-btn--danger') === true
    const actionsBefore = window.__gpFixture.actions.length
    ok?.click()
    await wait(250)
    result.actions = window.__gpFixture.actions.slice(actionsBefore)
    result.modalClosed = document.querySelector('.gp-modal--sm') === null
    return result
  }, { stage: STAGE_GLYPH, unstage: UNSTAGE_GLYPH })
  await page.close()
  return { out, errors }
}

/** (b2): a staged-only pick mixed with a working-tree pick. */
async function stagedOnlyScenario() {
  const { page, errors } = await openPanel(SNAP)
  const out = await page.evaluate(async (glyphs) => {
    const result = {}
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const rows = () => [...document.querySelectorAll('.gp-file-row')]
    const rowOf = (name, glyph) => rows().find((r) => (r.querySelector('.gp-tree-name')?.textContent ?? '') === name
      && (r.querySelector('.gp-file-row__actions .gp-icon-btn')?.textContent ?? '') === glyph) ?? null
    const pick = async (name, glyph) => {
      rowOf(name, glyph)?.querySelector('input.gp-check')?.click()
      await wait(60)
    }
    const picked = () => document.querySelector('.gp-changes__discard-picked')

    await pick('s1.txt', glyphs.unstage)
    result.disabledStagedOnly = picked().disabled === true
    await pick('w1.txt', glyphs.stage)
    result.enabledMixed = picked().disabled === false
    picked().click()
    await wait(150)
    const modal = document.querySelector('.gp-modal--sm')
    result.modalTexts = [...(modal?.querySelectorAll('.gp-modal__confirmtext') ?? [])].map((n) => n.textContent)
    const actionsBefore = window.__gpFixture.actions.length
    ;[...document.querySelectorAll('.gp-modal--sm .gp-modal__footer .gp-btn--danger')][0]?.click()
    await wait(250)
    result.actions = window.__gpFixture.actions.slice(actionsBefore)
    return result
  }, { stage: STAGE_GLYPH, unstage: UNSTAGE_GLYPH })
  await page.close()
  return { out, errors }
}

/** (b3): an untracked directory reaches the request and is named as a disk deletion. */
async function untrackedDirScenario() {
  const { page, errors } = await openPanel(SNAP)
  const out = await page.evaluate(async (glyphs) => {
    const result = {}
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const rowOf = (name, glyph) => [...document.querySelectorAll('.gp-file-row')].find((r) => (r.querySelector('.gp-tree-name')?.textContent ?? '') === name
      && (r.querySelector('.gp-file-row__actions .gp-icon-btn')?.textContent ?? '') === glyph) ?? null
    const picked = () => document.querySelector('.gp-changes__discard-picked')

    // The untracked directory is one row (porcelain collapses `?? newdir/`).
    rowOf('newdir', glyphs.stage)?.querySelector('input.gp-check')?.click()
    await wait(60)
    result.enabled = picked().disabled === false
    picked().click()
    await wait(150)
    const modal = document.querySelector('.gp-modal--sm')
    result.modalTexts = [...(modal?.querySelectorAll('.gp-modal__confirmtext') ?? [])].map((n) => n.textContent)
    const actionsBefore = window.__gpFixture.actions.length
    ;[...document.querySelectorAll('.gp-modal--sm .gp-modal__footer .gp-btn--danger')][0]?.click()
    await wait(250)
    result.actions = window.__gpFixture.actions.slice(actionsBefore)
    return result
  }, { stage: STAGE_GLYPH })
  await page.close()
  return { out, errors }
}

/** (c)+(d): real pointer hover on the row buttons, tip text and delay. */
async function tipsScenario() {
  const { page, errors } = await openPanel(SNAP)
  const row = (name) => page.locator('.gp-file-row', { hasText: name })
  const button = (name, index) => row(name).locator('.gp-file-row__actions .gp-icon-btn').nth(index)
  // Record when the pointer enters the button and when the tooltip mounts, so
  // the 140ms delay is measured instead of assumed.
  await page.evaluate(() => {
    window.__tipLog = []
    document.addEventListener('mouseover', (e) => {
      const btn = e.target instanceof Element ? e.target.closest('.gp-file-row__actions .gp-icon-btn') : null
      if (btn !== null) window.__tipLog.push({ kind: 'hover', at: performance.now() })
    }, true)
    new MutationObserver(() => {
      const tip = document.querySelector('div.gp-tip.gp-tip--sb')
      if (tip !== null) window.__tipLog.push({ kind: 'tip', at: performance.now(), text: tip.textContent })
    }).observe(document.body, { childList: true, subtree: true })
  })
  const tip = () => page.evaluate(() => {
    const el = document.querySelector('div.gp-tip.gp-tip--sb')
    return el === null ? null : { text: el.textContent, onBody: el.parentElement === document.body }
  })
  const clearLog = () => page.evaluate(() => { window.__tipLog.length = 0 })
  const readLog = () => page.evaluate(() => window.__tipLog.slice())
  const hoverButton = async (locator) => {
    // The actions are `visibility:hidden` until their row is hovered, so enter
    // the row first (a hidden box also fails Playwright's actionability check).
    await clearLog()
    await locator.hover()
    await page.waitForTimeout(300)
  }

  const result = {}
  // (d) stage hint on the working-tree row.
  await row('w1.txt').hover()
  const plus = button('w1.txt', 0)
  await hoverButton(plus)
  result.stageTip = await tip()
  result.stageLog = await readLog()
  result.stageAria = await plus.getAttribute('aria-label')
  result.stageTitle = await plus.getAttribute('title')
  result.stageGlyph = await plus.textContent()
  await page.mouse.move(2, 2)
  await page.waitForTimeout(150)
  result.stageTipGone = (await tip()) === null

  // (c) discard hint + the armed wording after one click.
  const discard = button('w1.txt', 1)
  await row('w1.txt').hover()
  await hoverButton(discard)
  result.discardTip = await tip()
  result.discardAria = await discard.getAttribute('aria-label')
  result.discardTitle = await discard.getAttribute('title')
  result.discardGlyph = await discard.textContent()
  const actionsBefore = await page.evaluate(() => window.__gpFixture.actions.length)
  await discard.click()
  await page.waitForTimeout(150)
  result.armedAria = await discard.getAttribute('aria-label')
  result.armedGlyph = await discard.textContent()
  result.tipHiddenOnClick = (await tip()) === null
  result.firstClickRunsNothing = await page.evaluate((n) => window.__gpFixture.actions.length === n, actionsBefore)
  await page.mouse.move(2, 2)
  await page.waitForTimeout(150)
  await row('w1.txt').hover()
  await hoverButton(discard)
  result.armedTip = await tip()
  result.armedLog = await readLog()

  // The staged row's first button is the inverse action, with its own copy.
  await row('s1.txt').hover()
  const minus = button('s1.txt', 0)
  await hoverButton(minus)
  result.unstageTip = await tip()
  result.unstageAria = await minus.getAttribute('aria-label')
  result.unstageGlyph = await minus.textContent()

  await page.close()
  return { out: result, errors }
}

/** The measured hover→tooltip delay, only meaningful when both entries exist. */
function tipDelay(log) {
  const hover = [...log].reverse().find((e) => e.kind === 'hover')
  const shown = [...log].reverse().find((e) => e.kind === 'tip')
  return hover === undefined || shown === undefined ? -1 : Math.round(shown.at - hover.at)
}

try {
  const batch = await batchScenario()
  assert.equal(batch.errors.length, 0, 'no console errors: ' + JSON.stringify(batch.errors))
  // Fixture sanity: staged rows first (del.txt / dup.txt / s1.txt), then the
  // working-tree ones, then the untracked directory; no group is collapsed.
  assert.deepEqual(batch.out.rows, ['del.txt:\u2212', 'dup.txt:\u2212', 's1.txt:\u2212', 'dup.txt:+', 'w1.txt:+', 'newdir:+'], 'one row per changed side, staged group first')
  // The index side has no working-tree changes to discard: offering the button
  // there used to no-op (`M `/`A `/`R `) or fail outright (`D `, del.txt here).
  assert.deepEqual(batch.out.rowActions, [
    { row: 'del.txt:\u2212', labels: ['取消暂存'] },
    { row: 'dup.txt:\u2212', labels: ['取消暂存'] },
    { row: 's1.txt:\u2212', labels: ['取消暂存'] },
    { row: 'dup.txt:+', labels: ['暂存', '放弃更改'] },
    { row: 'w1.txt:+', labels: ['暂存', '放弃更改'] },
    { row: 'newdir:+', labels: ['暂存', '放弃更改'] },
  ], 'index-side rows offer unstage only; working-tree and untracked rows keep both actions')
  assert.equal(batch.out.entryAfterUnstageAll, true, 'the discard entry follows "unstage all": ' + JSON.stringify(batch.out.toolbar))
  assert.equal(batch.out.entryBeforeStash, true, 'the discard entry precedes "stash changes": ' + JSON.stringify(batch.out.toolbar))
  assert.equal(batch.out.entryLabel, '放弃选中的更改', 'toolbar label is the zh entry copy')
  assert.equal(batch.out.disabledEmpty, true, 'nothing picked → the entry is disabled')
  assert.equal(batch.out.disabledStagedOnly, true, 'a staged-only pick has nothing to discard → still disabled')
  assert.equal(batch.out.enabledAfterPicks, true, 'two working-tree picks enable the entry')
  assert.equal(batch.out.modalShown, true, 'clicking the entry opens the confirm dialog')
  assert.equal(batch.out.modalPortaled, true, 'the dialog is portaled outside the panel')
  assert.equal(batch.out.modalTitle, '放弃选中的更改', 'dialog title')
  // Only the deduped count, never the file names: dup.txt is one file even
  // though both of its rows are picked, and its `:s` row is not staged-only.
  assert.deepEqual(batch.out.modalTexts, ['将放弃 2 个文件在工作区的未提交更改，此操作不可恢复。'], 'body carries the deduped count and no file list')
  assert.equal(batch.out.confirmLabel, '放弃更改', 'confirm button label')
  assert.equal(batch.out.confirmDanger, true, 'confirm button carries the danger style')
  assert.deepEqual(batch.out.actions, [{ kind: 'discard', paths: ['dup.txt', 'w1.txt'] }], 'one discard action with the deduped working-tree paths, sorted')
  assert.equal(batch.out.modalClosed, true, 'a landed discard closes the dialog')

  const stagedOnly = await stagedOnlyScenario()
  assert.equal(stagedOnly.errors.length, 0, 'no console errors: ' + JSON.stringify(stagedOnly.errors))
  assert.equal(stagedOnly.out.disabledStagedOnly, true, 'staged-only alone keeps the entry disabled')
  assert.equal(stagedOnly.out.enabledMixed, true, 'a working-tree pick enables it again')
  assert.deepEqual(stagedOnly.out.modalTexts, [
    '将放弃 1 个文件在工作区的未提交更改，此操作不可恢复。',
    '另有 1 个选中项在暂存区，不在此次放弃范围（如需撤销暂存请用「取消暂存」）。',
  ], 'an index-side pick is reported as out of scope, not silently swallowed')
  assert.deepEqual(stagedOnly.out.actions, [{ kind: 'discard', paths: ['w1.txt'] }], 'the staged-only path never reaches the request')

  // Untracked targets are deleted from disk, not restored from the index — the
  // host does that recursively now, so a directory must reach the request too.
  const untrackedDir = await untrackedDirScenario()
  assert.equal(untrackedDir.errors.length, 0, 'no console errors: ' + JSON.stringify(untrackedDir.errors))
  assert.equal(untrackedDir.out.enabled, true, 'an untracked directory pick enables the entry')
  assert.deepEqual(untrackedDir.out.modalTexts, [
    '将放弃 1 个文件在工作区的未提交更改，此操作不可恢复。',
    '其中 1 个是未跟踪的文件或目录，将从磁盘删除（不在 Git 历史中，无法恢复）。',
  ], 'untracked targets are called out as disk deletions')
  assert.deepEqual(untrackedDir.out.actions, [{ kind: 'discard', paths: ['newdir'] }], 'the untracked directory reaches the discard request')

  const tips = await tipsScenario()
  assert.equal(tips.errors.length, 0, 'no console errors: ' + JSON.stringify(tips.errors))
  assert.equal(tips.out.stageGlyph, '+', 'the working-tree row shows the stage glyph')
  assert.equal(tips.out.stageTip?.text, '暂存此文件，下一次提交会包含它的改动', 'stage hover hint copy')
  assert.equal(tips.out.stageTip?.onBody, true, 'the hint is portaled to body')
  assert.ok(tipDelay(tips.out.stageLog) >= 100 && tipDelay(tips.out.stageLog) <= 400, `the hint waits for the ~140ms hover delay (measured ${tipDelay(tips.out.stageLog)}ms)`)
  assert.equal(tips.out.stageAria, '暂存', 'the aria-label keeps the short name')
  assert.equal(tips.out.stageTitle, null, 'no native title is left behind')
  assert.equal(tips.out.stageTipGone, true, 'leaving the button dismisses the hint')
  assert.equal(tips.out.discardGlyph, DISCARD_GLYPH, 'the discard button keeps its glyph')
  assert.equal(tips.out.discardTip?.text, '放弃此文件在工作区的改动（不可恢复）；再点一次确认', 'discard hover hint copy')
  assert.equal(tips.out.discardAria, '放弃更改', 'the discard aria-label keeps the short name')
  assert.equal(tips.out.discardTitle, null, 'no native title is left behind')
  assert.equal(tips.out.armedAria, '再次点击以确认放弃', 'the armed button announces the confirm step')
  assert.equal(tips.out.armedGlyph, DISCARD_GLYPH, 'arming keeps the glyph (only the wording/color changes)')
  assert.equal(tips.out.tipHiddenOnClick, true, 'clicking drops the hint instead of leaving it floating')
  assert.equal(tips.out.firstClickRunsNothing, true, 'the first click only arms; nothing runs')
  assert.equal(tips.out.armedTip?.text, '再点一次即放弃此文件的改动，不可恢复', 'armed hover hint copy')
  assert.ok(tipDelay(tips.out.armedLog) >= 100 && tipDelay(tips.out.armedLog) <= 400, `the armed hint keeps the fast delay (measured ${tipDelay(tips.out.armedLog)}ms)`)
  assert.equal(tips.out.unstageGlyph, UNSTAGE_GLYPH, 'the staged row shows the unstage glyph')
  assert.equal(tips.out.unstageTip?.text, '取消暂存此文件，改动仍留在工作区', 'unstage hover hint copy')
  assert.equal(tips.out.unstageAria, '取消暂存', 'the unstage aria-label keeps the short name')

  console.log('e2e changes-discard.mjs: PASS', JSON.stringify({
    discard: batch.out.actions, stagedOnly: stagedOnly.out.actions,
    stageDelay: tipDelay(tips.out.stageLog), armedDelay: tipDelay(tips.out.armedLog),
    tips: [tips.out.stageTip?.text, tips.out.discardTip?.text, tips.out.armedTip?.text, tips.out.unstageTip?.text],
  }))
} catch (e) {
  console.error('e2e changes-discard.mjs: FAIL', e.message)
  process.exit(1)
} finally {
  await browser.close()
}
