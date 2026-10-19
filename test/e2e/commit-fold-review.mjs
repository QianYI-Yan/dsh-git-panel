/**
 * E2E: the commit editor's phone fold (issue #66).
 *
 * The editor folds into a one-row bar — so the change list keeps the height —
 * only while the *viewport* is phone-narrow. A desktop panel squeezed by a
 * sidebar is the compact layout too, but it keeps the full editor, so its AI
 * entry is never folded away. The folded bar carries its own AI entry (icon +
 * the two letters "AI"): one tap opens the editor and starts generating, so the
 * entry survives the fold on a phone as well.
 *
 * Isolated file:// harness, no dsh server. Requires test/e2e/setup.mjs first.
 */
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const DIR = dirname(fileURLToPath(import.meta.url))
const harness = 'file://' + resolve(DIR, 'harness.html')

const SNAP = {
  root: 'fixture-repo', branch: 'main', head: 'de54fc0', unborn: false, dirty: true,
  staged: 0, modified: 2, untracked: 0, ahead: 0, behind: 0, hasUpstream: true,
  remote: { name: 'origin', url: 'git@github.com:owner/repo.git', webUrl: 'https://github.com/owner/repo', host: 'github.com', hostKind: 'github' },
  lastCommit: null,
  changes: [
    { path: 'a.txt', status: 'modified', staged: false, isDirectory: false },
    { path: 'b.txt', status: 'modified', staged: false, isDirectory: false },
  ],
  stats: { fileCount: 2, staged: 0, modified: 2, untracked: 0, insertions: 3, deletions: 1, lastChangeAt: Date.now(), headCommittedAt: null },
  truncated: false, refreshIntervalMs: 0, showInputPill: true, suggestEnabled: true,
  defaultDiffView: 'unified', checkedAt: Date.now(),
}

/** Nothing to generate from: the AI entries are unavailable, the bar stays. */
const CLEAN = {
  ...SNAP, dirty: false, changes: [], modified: 0, stats: { ...SNAP.stats, fileCount: 0, modified: 0, insertions: 0, deletions: 0 },
}

const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1280, height: 720 }
/** Panel heights (the box, not the viewport): 764 is roomy, 420 is cramped. */
const ROOMY_PANEL = 764
const CRAMPED_PANEL = 420

const browser = await chromium.launch()

/**
 * Mount the panel against the mock connection with the real zh dictionary.
 * `height` is the panel box (not the viewport): the fold is decided by the
 * panel's own width and height together, so the tests drive those directly.
 */
async function openPanel(snapshot, { viewport, width, height = 764 }) {
  const page = await browser.newPage({ viewport })
  const errors = []
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
  await page.goto(harness)
  await page.addScriptTag({ path: resolve(DIR, 'client.js') })
  await page.addScriptTag({ path: resolve(DIR, 'mock-rpc.mjs') })
  await page.evaluate(async ({ snapshot, width, height }) => {
    const panel = document.getElementById('panel')
    panel.style.width = `${width}px`
    panel.style.height = `${height}px`
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
      locale: {
        register: (ns, dict) => { dictionaries[ns] = dict },
        bind: (ns) => (key, params) => {
          const raw = dictionaries[ns] && dictionaries[ns].zh[key]
          return raw === undefined ? key : interpolate(raw, params)
        },
      },
    }
    window.__getLoaded().apply(ctx)
    window.ReactDOM.createRoot(panel).render(registered['conversation.view'].component({ sessionId: 'sess-1' }))
    await new Promise((r) => setTimeout(r, 500))
  }, { snapshot, width, height })
  // A clean snapshot opens on the overview tab; the commit box lives on Changes.
  await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    if (document.querySelector('.gp-commitbar, .gp-commitbox') !== null) return
    const tab = [...document.querySelectorAll('.gp-panel [role="tab"]')].find((t) => (t.textContent || '').includes('变更'))
    tab?.click()
    await wait(400)
  })
  return { page, errors }
}

/**
 * A desktop window whose panel a sidebar squeezed to 400px: compact columns,
 * full editor — the regression this issue is about.
 */
async function squeezedDesktopScenario() {
  const { page, errors } = await openPanel(SNAP, { viewport: DESKTOP, width: 400 })
  const out = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const result = {
      layout: document.querySelector('.gp-panel')?.getAttribute('data-layout'),
      editor: document.querySelector('.gp-commitbox') !== null,
      bar: document.querySelector('.gp-commitbar') !== null,
      foldControl: document.querySelector('.gp-commitbox__fold') !== null,
      aiLabel: document.querySelector('.gp-commitbox__actions .gp-btn:not(.gp-btn--primary)')?.textContent ?? null,
    }
    document.querySelector('.gp-stats')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await wait(120)
    result.pressKeepsEditor = document.querySelector('.gp-commitbox') !== null
    return result
  })
  await page.close()
  return { out, errors }
}

/**
 * A phone: the bar stands in for the editor, its AI entry opens the editor and
 * generates, the fold control puts the bar back, and a height change re-lays
 * the editor out live.
 */
async function phoneScenario() {
  const { page, errors } = await openPanel(SNAP, { viewport: PHONE, width: PHONE.width, height: CRAMPED_PANEL })
  const out = await page.evaluate(async () => {
    const result = {}
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const waitFor = async (predicate, label) => {
      for (let i = 0; i < 80; i++) { if (predicate()) return true; await wait(25) }
      throw new Error('timed out waiting for ' + label)
    }
    const bar = () => document.querySelector('.gp-commitbar')
    const editor = () => document.querySelector('.gp-commitbox')
    const fixture = window.__gpFixture
    const panelRect = () => document.querySelector('.gp-panel').getBoundingClientRect()
    const rect = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height } }

    result.layout = document.querySelector('.gp-panel')?.getAttribute('data-layout')
    result.folded = bar() !== null && editor() === null
    result.barHeight = Math.round(bar()?.getBoundingClientRect().height ?? 0)
    result.placeholder = bar()?.querySelector('.gp-commitbar__ph')?.textContent ?? null
    const ai = bar()?.querySelector('.gp-commitbar__ai') ?? null
    const open = bar()?.querySelector('.gp-commitbar__open') ?? null
    const commit = bar()?.querySelector('.gp-commitbar__commit') ?? null
    result.aiShown = ai !== null
    // "Only the icon and the two letters": the visible label is exactly AI, the
    // full wording rides the accessible name.
    result.aiLabel = ai?.textContent ?? null
    result.aiAria = ai?.getAttribute('aria-label') ?? null
    result.aiTitle = ai?.getAttribute('title') ?? null
    result.aiIcon = ai?.querySelector('svg') !== null
    result.aiDisabled = ai?.disabled ?? null
    result.commitDisabled = commit?.disabled ?? null
    // One row, left to right: message field, AI, Commit; all inside the panel.
    const aiRect = ai === null ? null : rect(ai)
    const openRect = open === null ? null : rect(open)
    const commitRect = commit === null ? null : rect(commit)
    result.barOrder = aiRect !== null && openRect !== null && commitRect !== null
      && openRect.right <= aiRect.left + 1 && aiRect.right <= commitRect.left + 1
    const centres = [openRect, aiRect, commitRect].map((r) => r === null ? null : (r.top + r.bottom) / 2)
    result.barOneRow = centres.every((c) => c !== null && Math.abs(c - centres[1]) <= 1)
    result.barInsidePanel = [openRect, aiRect, commitRect].every((r) => r !== null
      && r.left >= panelRect().left - 1 && r.right <= panelRect().right + 1)
    result.aiCompact = aiRect !== null && aiRect.width <= 72

    // Tapping the field opens the editor and generates nothing.
    open?.click()
    await wait(150)
    result.openShowsEditor = editor() !== null && bar() === null
    result.openAutofocus = document.activeElement === document.querySelector('.gp-commitbox__msg')
    result.openNoGeneration = fixture.suggestCalls === 0
    document.querySelector('.gp-commitbox__fold')?.click()
    await wait(150)
    result.foldControlBack = bar() !== null && editor() === null

    // A truncated suggestion surfaces its notice; the notice never folds the
    // editor away (only its close button dismisses it). The bar was remounted by
    // the fold above, so its AI entry is re-read rather than reused.
    fixture.suggestTruncated = true
    const barAi = bar()?.querySelector('.gp-commitbar__ai') ?? null
    barAi?.click()
    await waitFor(() => fixture.suggestCalls === 1 && typeof fixture.releaseSuggest === 'function', 'the suggestion RPC')
    result.aiShowsEditor = editor() !== null && bar() === null
    result.aiGenerating = document.querySelector('.gp-commitbox__msg')?.readOnly === true
    result.aiSpinner = document.querySelector('.gp-commitbox__msg-wrap .gp-commitbox__spin') !== null
    fixture.releaseSuggest()
    await waitFor(() => document.querySelector('.gp-commitbox__msg')?.readOnly === false, 'the suggestion to land')
    result.aiFilled = document.querySelector('.gp-commitbox__msg')?.value === 'feat: suggested'
    const notice = document.querySelector('.gp-notice')
    result.noticeShown = notice !== null
    notice?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await wait(100)
    result.noticePressKeepsEditor = editor() !== null
    document.querySelector('.gp-notice__close')?.click()
    await wait(100)
    result.noticeClosed = document.querySelector('.gp-notice') === null
    fixture.suggestTruncated = false

    // The fold control reads as a button and shares one 30px row with them.
    const foldBtn = document.querySelector('.gp-commitbox__fold')
    document.querySelector('.gp-panel').style.setProperty('--dsw-alias-border-l2', '#888888')
    document.querySelector('.gp-panel').style.setProperty('--dsw-alias-bg-layer-2', '#f2f3f5')
    await wait(200)
    const foldStyle = foldBtn === null ? null : getComputedStyle(foldBtn)
    result.foldStyled = foldBtn !== null
      && parseFloat(foldStyle.borderTopWidth) >= 1
      && foldStyle.borderTopStyle === 'solid'
      && foldStyle.backgroundColor !== 'rgba(0, 0, 0, 0)'
    document.querySelector('.gp-panel').style.removeProperty('--dsw-alias-border-l2')
    document.querySelector('.gp-panel').style.removeProperty('--dsw-alias-bg-layer-2')
    const rowBtns = [
      document.querySelector('.gp-commitbox__actions .gp-btn:not(.gp-btn--primary)'),
      document.querySelector('.gp-commitbox__actions .gp-btn--primary'),
      foldBtn,
    ].filter((b) => b !== null)
    result.rowAligned = rowBtns.length === 3
      && new Set(rowBtns.map((b) => Math.round(b.getBoundingClientRect().height))).size === 1
      && new Set(rowBtns.map((b) => Math.round(b.getBoundingClientRect().top + b.getBoundingClientRect().height / 2))).size === 1
    result.rowBtnHeight = rowBtns.length > 0 ? Math.round(rowBtns[0].getBoundingClientRect().height) : 0

    // Folding keeps the draft: the bar summarises it and can commit it.
    foldBtn?.click()
    await wait(150)
    result.refolded = bar() !== null && editor() === null
    result.draftShown = bar()?.querySelector('.gp-commitbar__draft')?.textContent === 'feat: suggested'
    result.draftSubmittable = bar()?.querySelector('.gp-commitbar__commit')?.disabled === false
    return result
  })

  // Height changes re-decide the fold live, without a remount: regaining room
  // unfolds the editor even though the panel stays narrow.
  await page.evaluate((h) => { document.getElementById('panel').style.height = `${h}px` }, ROOMY_PANEL)
  await page.waitForTimeout(250)
  const roomy = await page.evaluate(() => ({
    bar: document.querySelector('.gp-commitbar') !== null,
    editor: document.querySelector('.gp-commitbox') !== null,
    foldControl: document.querySelector('.gp-commitbox__fold') !== null,
    draft: document.querySelector('.gp-commitbox__msg')?.value ?? null,
  }))
  await page.evaluate((h) => { document.getElementById('panel').style.height = `${h}px` }, CRAMPED_PANEL)
  await page.waitForTimeout(250)
  const backToCramped = await page.evaluate(() => ({
    bar: document.querySelector('.gp-commitbar') !== null,
    editor: document.querySelector('.gp-commitbox') !== null,
    draft: document.querySelector('.gp-commitbar__draft')?.textContent ?? null,
  }))
  await page.close()
  return { out, roomy, backToCramped, errors }
}

/** The AI entries follow the setting on both layouts. */
async function aiSettingScenario() {
  const off = await openPanel({ ...SNAP, suggestEnabled: false }, { viewport: PHONE, width: PHONE.width, height: CRAMPED_PANEL })
  const offOut = await off.page.evaluate(() => ({
    bar: document.querySelector('.gp-commitbar') !== null,
    ai: document.querySelector('.gp-commitbar__ai') !== null,
    commit: document.querySelector('.gp-commitbar__commit') !== null,
  }))
  await off.page.close()

  const clean = await openPanel(CLEAN, { viewport: PHONE, width: PHONE.width, height: CRAMPED_PANEL })
  const cleanOut = await clean.page.evaluate(() => ({
    bar: document.querySelector('.gp-commitbar') !== null,
    aiDisabled: document.querySelector('.gp-commitbar__ai')?.disabled ?? null,
    commitDisabled: document.querySelector('.gp-commitbar__commit')?.disabled ?? null,
    empty: document.querySelector('.gp-changes__list .gp-empty')?.textContent ?? null,
  }))
  await clean.page.close()
  return { off: { out: offOut, errors: off.errors }, clean: { out: cleanOut, errors: clean.errors } }
}

const squeezed = await squeezedDesktopScenario()
const phone = await phoneScenario()
const setting = await aiSettingScenario()
await browser.close()

try {
  assert.equal(squeezed.errors.length, 0, 'no console errors: ' + JSON.stringify(squeezed.errors))
  assert.equal(squeezed.out.layout, 'compact', 'a 400px desktop panel is the compact layout')
  assert.equal(squeezed.out.editor, true, 'a squeezed desktop panel keeps the full commit editor')
  assert.equal(squeezed.out.bar, false, 'no folded commit bar while the panel is tall')
  assert.equal(squeezed.out.foldControl, false, 'no fold control when the editor cannot fold')
  assert.equal(squeezed.out.aiLabel, 'AI 生成', 'the AI entry stays visible in a squeezed desktop panel')
  assert.equal(squeezed.out.pressKeepsEditor, true, 'a press outside the editor leaves it open when it cannot fold')

  assert.equal(phone.errors.length, 0, 'no console errors: ' + JSON.stringify(phone.errors))
  const p = phone.out
  assert.equal(p.layout, 'compact', 'a phone viewport mounts the compact layout')
  assert.equal(p.folded, true, 'a narrow and short panel starts the editor folded into one bar')
  assert.ok(p.barHeight <= 48, `the folded bar stays one row (${p.barHeight}px)`)
  assert.equal(p.placeholder, '提交信息', 'the folded bar shows the empty placeholder')
  assert.equal(p.aiShown, true, 'the folded bar carries an AI entry')
  assert.equal(p.aiLabel, 'AI', 'the folded AI entry shows the two letters only')
  assert.equal(p.aiAria, 'AI 生成', 'the folded AI entry keeps the full accessible name')
  assert.equal(p.aiTitle, 'AI 生成', 'the folded AI entry explains itself on hover/long-press')
  assert.equal(p.aiIcon, true, 'the folded AI entry carries the sparkle icon')
  assert.equal(p.aiDisabled, false, 'the AI entry is enabled while there are changes')
  assert.equal(p.aiCompact, true, 'the folded AI entry is narrow enough for the row')
  assert.equal(p.barOrder, true, 'the AI entry sits between the message field and Commit')
  assert.equal(p.barOneRow, true, 'the folded bar keeps its three controls on one row')
  assert.equal(p.barInsidePanel, true, 'the folded bar fits inside the panel')
  assert.equal(p.openShowsEditor, true, 'tapping the field opens the full editor')
  assert.equal(p.openAutofocus, true, 'the opened editor takes focus (keyboard opens)')
  assert.equal(p.openNoGeneration, true, 'opening the editor does not start a generation')
  assert.equal(p.foldControlBack, true, 'the fold control puts the one-row bar back')
  assert.equal(p.aiShowsEditor, true, 'tapping the folded AI entry opens the full editor')
  assert.equal(p.aiGenerating, true, 'the message field locks while the suggestion is in flight')
  assert.equal(p.aiSpinner, true, 'the in-flight generation shows its field spinner')
  assert.equal(p.aiFilled, true, 'the suggestion fills the opened editor')
  assert.equal(p.noticeShown, true, 'a truncated suggestion shows its notice above the editor')
  assert.equal(p.noticePressKeepsEditor, true, 'pressing the notice keeps the editor open')
  assert.equal(p.noticeClosed, true, 'the notice close button dismisses the banner')
  assert.equal(p.foldStyled, true, 'the fold control reads as a button (fill + border)')
  assert.equal(p.rowAligned, true, 'AI / Commit / fold share one row height and centre')
  assert.ok(p.rowBtnHeight > 0 && p.rowBtnHeight <= 32, `the phone commit row uses one compact height (${p.rowBtnHeight}px)`)
  assert.equal(p.refolded, true, 'the fold control folds the editor back')
  assert.equal(p.draftShown, true, 'the folded bar summarises the draft first line')
  assert.equal(p.draftSubmittable, true, 'a draft can be committed from the folded bar')
  assert.deepEqual(phone.roomy, { bar: false, editor: true, foldControl: false, draft: 'feat: suggested' },
    'regaining height unfolds the editor without a remount, however narrow the panel stays')
  assert.deepEqual(phone.backToCramped, { bar: true, editor: false, draft: 'feat: suggested' },
    'losing height again folds it back with the draft intact')

  assert.equal(setting.off.errors.length, 0, 'no console errors: ' + JSON.stringify(setting.off.errors))
  assert.deepEqual(setting.off.out, { bar: true, ai: false, commit: true },
    'the folded bar drops the AI entry when generation is off, keeping Commit')
  assert.equal(setting.clean.errors.length, 0, 'no console errors: ' + JSON.stringify(setting.clean.errors))
  assert.equal(setting.clean.out.bar, true, 'a clean repo still folds the editor when the panel is cramped')
  assert.equal(setting.clean.out.aiDisabled, true, 'the AI entry is disabled with nothing to read')
  assert.equal(setting.clean.out.commitDisabled, true, 'Commit stays disabled with an empty message box')
  assert.equal(setting.clean.out.empty, '没有未提交的变更', 'the clean fixture really has no changes')

  console.log('e2e commit-fold-review.mjs: PASS', JSON.stringify({
    squeezed: squeezed.out, phone: { bar: p.barHeight, ai: p.aiLabel, row: p.rowBtnHeight }, off: setting.off.out,
  }))
} catch (e) {
  console.error('e2e commit-fold-review.mjs: FAIL', e.message)
  process.exit(1)
}
