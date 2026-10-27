/**
 * E2E: the repository list and the checkout it selects.
 *
 * A workspace may hold nested repositories beside its own checkout (issue
 * #83). The Git overview lists every checkout in its left column, above the
 * branch tree, so picking one keeps branches, commit list and the list itself
 * on screen together; the pick rides every repository-scoped request while the
 * panes themselves never learn about it. The compact layout has no left column,
 * so it keeps a Repositories page. The list block boots collapsed with the
 * checkout in use named in its head line, and no row ever represents a non-git
 * workspace root. A cwd that is not a checkout shows **no repository entries**:
 * it opens straight into its first sub-repository (a session that never picked
 * anything); a scan that found nothing shows the browser alone with the tree
 * column's status bar (absolute path, click-to-copy, refresh). The probe switch
 * (detail-page config) re-answers the list in place: flipping it off empties
 * the list (one checkout needs no list) with no page switch.
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

// Scenario B/C: a repository family (the main work tree plus its worktrees)
// next to unrelated repositories of the workspace. The two disabled worktrees
// are the host's trust decisions: one outside the cwd, one whose directory is
// gone — both stay visible, neither may ever be picked.
const WT_WORKSPACE = { path: '', root: 'fixture-repo', name: 'fixture-repo', kind: 'workspace', role: 'main', branch: 'main' }
const WT_LINKED = { path: '.agents/worktrees/feat/sidebar', root: 'fixture-repo/.agents/worktrees/feat/sidebar', name: 'sidebar', kind: 'nested', role: 'linked', branch: 'feat/sidebar' }
const WT_OUTSIDE = { path: '../spike', root: '/mock/spike', name: 'spike', kind: 'nested', role: 'linked', branch: 'spike', disabled: 'outside' }
const WT_STALE = { path: 'gone', root: 'fixture-repo/gone', name: 'gone', kind: 'nested', role: 'linked', branch: 'old', disabled: 'stale' }
const MIXED_FAMILY = [WT_WORKSPACE, WT_LINKED, WT_OUTSIDE, WT_STALE, NESTED_REPO, DEEP_REPO]

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
  if (options.viewportWidth !== undefined) {
    await page.setViewportSize({ width: options.viewportWidth, height: 780 })
  }
  await page.goto(harness)
  // The layout mode is measured on the panel's own box, not on the viewport: a
  // squeezed desktop panel is as compact as a phone's.
  if (options.panelWidth !== undefined) {
    await page.evaluate((width) => {
      const el = document.getElementById('panel')
      el.style.width = width + 'px'
      el.style.height = '700px'
    }, options.panelWidth)
  }
  await page.addScriptTag({ path: resolve(DIR, 'client.js') })
  await page.addScriptTag({ path: resolve(DIR, 'mock-rpc.mjs') })
  // `true` fails the untagged sample (a cwd that is not a checkout); a code
  // string fails the tagged ones (a pick the host can no longer resolve).
  const snapshotFails = options.snapshotFails === true
    ? true
    : typeof options.snapshotFails === 'string' ? options.snapshotFails : false
  const snap = options.dirty === true
    ? { ...SNAP, dirty: true, modified: 2, changes: [{ path: 'a.txt', status: 'M', side: 'worktree' }] }
    : SNAP
  // A non-zero poll makes fresh snapshots arrive on their own — the way the
  // config form's resync delivers a flipped switch to the panel.
  const snapUsed = options.pollMs === undefined ? snap : { ...snap, refreshIntervalMs: options.pollMs }
  const scene = options.scene || 'scene'
  const out = await page.evaluate(async ({ snap, repos: listed, action, snapshotFails, scene, probeToggle }) => {
    const React = window.React
    const origWarn = console.warn.bind(console)
    console.warn = (...args) => origWarn('[' + scene + ']', ...args)
    const { fixture, connection } = window.createGitPanelMock(snap)
    fixture.repos = listed
    // Every repository-scoped request, so the test can prove the pick reaches
    // the wire rather than only the row highlight. The client captures the
    // connection face before apply(), so patch it first.
    // Scenario 9: the probe switch (config) flips mid-run — snapshots then
    // carry detectCheckouts:false and repo-list answers with the workspace row
    // alone, the way the host gates its two probes behind that switch.
    const probe = { active: probeToggle, off: false }
    const calls = []
    const mockCall = connection.rpc.call
    connection.rpc.call = async (channel, endpoint, payload) => {
      const request = payload && payload.args && payload.args.request
      calls.push({
        endpoint,
        kind: request && request.query ? request.query.kind : null,
        repo: request && typeof request.repo === 'string' ? request.repo : '',
      })
      if (probe.active && endpoint === 'gitPanel/snapshot') {
        const tag = request && typeof request.repo === 'string' ? request.repo : ''
        return { ok: true, value: { ok: true, value: { ...snap, detectCheckouts: !probe.off, root: tag === '' ? snap.root : 'fixture-repo/' + tag } } }
      }
      if (probe.active && endpoint === 'gitPanel/query' && request && request.query && request.query.kind === 'repo-list') {
        const rows = probe.off ? listed.filter((entry) => entry.path === '') : listed
        return { ok: true, value: { ok: true, value: { kind: 'repo-list', cwd: '/mock/workspace', repos: rows } } }
      }
      // A workspace directory that is not a checkout: the session root has no
      // repository of its own, only nested ones, so only the untagged request
      // fails. A pick of a nested checkout answers normally, which is what lets
      // the panel's default pick land on a git view.
      if (snapshotFails && endpoint === 'gitPanel/snapshot') {
        const tag = request && typeof request.repo === 'string' ? request.repo : ''
        const fails = snapshotFails === true ? tag === '' : tag !== ''
        if (fails) return { ok: true, value: { ok: false, error: { code: snapshotFails === true ? 'not-a-git-repo' : snapshotFails, cwd: '/mock/workspace' } } }
        return { ok: true, value: { ok: true, value: { ...snap, root: tag === '' ? snap.root : 'fixture-repo/' + tag } } }
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

    // Path lines may carry the invisible LRM prefix (rtlPathText); test reads
    // compare the visible path, so strip it.
    const textOf = (node, selector) => {
      const found = node.querySelector(selector)
      return found === null ? '' : found.textContent.replace(/\u200e/g, '').trim()
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
      // The branch chip sits on the name line; it may hold the row's own
      // reported branch (a worktree), the checked row's snapshot, or nothing.
      branch: textOf(node, '.gp-repolist__branch'),
      active: node.classList.contains('gp-repolist__item--active'),
      current: node.getAttribute('aria-current'),
      count: textOf(node, '.gp-repolist__count'),
      disabled: node.disabled === true,
      title: node.getAttribute('title') || '',
    }))
    const cardRows = () => [...document.querySelectorAll('.gp-panel .gp-repos__item')].map((node) => ({
      name: textOf(node, '.gp-repos__name'),
      path: textOf(node, '.gp-repos__path'),
      active: node.classList.contains('gp-repos__item--active'),
      current: node.getAttribute('aria-current'),
      disabled: node.disabled === true,
    }))
    // Group headers: they exist only when both checkout families do — a lone
    // family stays a flat list whose rows these helpers already read.
    const groupInfo = () => ({
      titles: [...document.querySelectorAll('.gp-panel .gp-repolist__grouptitle')].map((n) => n.textContent.trim()),
      counts: [...document.querySelectorAll('.gp-panel .gp-repolist__groupcount')].map((n) => n.textContent.trim()),
      labels: [...document.querySelectorAll('.gp-panel .gp-repolist__group')].map((n) => n.getAttribute('aria-label')),
      cardTitles: [...document.querySelectorAll('.gp-panel .gp-repos__grouptitle')].map((n) => n.textContent.trim()),
      cardCounts: [...document.querySelectorAll('.gp-panel .gp-repos__groupcount')].map((n) => n.textContent.trim()),
    })
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
    // A collapsed list is not on screen: every pick expands the block first.
    const expandRepos = async () => {
      const btn = document.querySelector('.gp-panel .gp-repolist__collapse')
      if (btn !== null && btn.getAttribute('aria-expanded') === 'false') {
        btn.click()
        await wait(250)
      }
    }
    // The head line: toggle state and, while collapsed, the checkout it names.
    const headInfo = () => {
      const btn = document.querySelector('.gp-panel .gp-repolist__collapse')
      const chip = document.querySelector('.gp-panel .gp-repolist__selected')
      return {
        present: btn !== null,
        expanded: btn === null ? null : btn.getAttribute('aria-expanded') === 'true',
        selected: chip === null ? '' : chip.textContent.trim(),
      }
    }
    // The body dims and the tab bar shows a badge while the next sample is in
    // flight; the list itself must stay put, or the switch reads as a collapse.
    const switchingNow = () => document.querySelector('.gp-panel').getAttribute('data-repo-switching') === 'true'
    // The tree column's header: the absolute browse root on the left, the
    // refresh control on the right — inside the directory tree column, never a
    // full-width row on top of the page, and never covering the entries.
    const statusbarInfo = () => {
      const bar = document.querySelector('.gp-panel .gp-files__statusbar')
      const wrap = document.querySelector('.gp-panel .gp-files__tree-wrap')
      const rows = document.querySelector('.gp-panel .gp-files__tree')
      const b = bar?.getBoundingClientRect()
      const w = wrap?.getBoundingClientRect()
      return {
        present: bar !== null,
        path: bar === null ? '' : textOf(bar, '.gp-files__status-code'),
        hasPath: bar !== null && bar.querySelector('.gp-files__status-path') !== null,
        refreshInBar: bar !== null && bar.querySelector('.gp-files__refresh') !== null,
        // Inside the tree column, above its scrolling entries, and exactly as
        // wide as that column (never spilling over the preview side).
        barInTree: !!(bar && wrap && wrap.contains(bar)),
        precedesRows: !!(bar && rows && (bar.compareDocumentPosition(rows) & 4) !== 0),
        spansColumnOnly: !!(b && w && Math.abs(b.width - w.width) <= 1),
      }
    }
    // Arm the clipboard spy the copy buttons write through (the harness
    // primitive prefers navigator.clipboard when the page provides one).
    const armClipboard = (field) => {
      window[field] = null
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (text) => { window[field] = text } },
      })
    }

    const observed = {
      tabs: tabLabels(),
      tabCount: document.querySelector('.gp-panel .gp-tabbar').getAttribute('data-tab-count'),
      switching: switchingNow(),
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
    // Boot state, read before any pick expands the block.
    observed.head = headInfo()
    if (action === 'compact') {
      // Compact has no left column to host the list, so it keeps a page of its
      // own: the bar gains a fourth cell, and its indicator has to follow the
      // count the panel put there rather than a hard-coded divisor.
      const track = document.querySelector('.gp-panel .gp-tabbar__tabs')
      const indicator = track === null ? null : track.querySelector('span[aria-hidden="true"]')
      observed.layout = document.querySelector('.gp-panel').getAttribute('data-layout')
      observed.indicator = indicator === null || track === null
        ? null
        : { width: indicator.getBoundingClientRect().width, track: track.getBoundingClientRect().width }
      clickTab('tab.reposShort')
      await wait(300)
      observed.picker = { activeTab: activeTabLabel(), cards: cardRows() }
      // The panes behind the picker are not on screen; none of them may start a
      // query of its own while the picker is the page in front.
      calls.length = 0
      await wait(900)
      observed.idleKinds = calls.filter((call) => call.endpoint === 'gitPanel/query').map((call) => call.kind)
      pickRow('.gp-repos__item', 'site')
      await wait(700)
      observed.afterPick = { activeTab: activeTabLabel(), cards: cardRows(), calls: calls.slice() }
      return { observed, calls }
    }
    if (action === 'worktree') {
      // The mixed workspace: one family of checkouts (main + worktrees, two of
      // them disabled) plus unrelated repositories. Nothing to navigate for a
      // clean checkout, but the list lives in the overview either way.
      if (activeTabLabel() !== 'tab.overview') {
        clickTab('tab.overview')
        await wait(300)
      }
      await expandRepos()
      observed.groups = groupInfo()
      observed.rows = listRows()
      // A disabled row must be inert: no request, no switch, no tab jump.
      let mark = calls.length
      pickRow('.gp-repolist__item', 'gone')
      await wait(400)
      observed.disabledTap = {
        switching: switchingNow(),
        active: listRows().map((row) => row.active),
        snapshots: calls.slice(mark).filter((call) => call.endpoint === 'gitPanel/snapshot'),
      }
      // A worktree pick rides every repository-scoped request, exactly like a
      // nested repository pick does.
      mark = calls.length
      pickRow('.gp-repolist__item', 'sidebar')
      await wait(700)
      observed.afterPick = {
        activeTab: activeTabLabel(),
        rows: listRows(),
        switching: switchingNow(),
        calls: calls.slice(mark),
      }
      // …and the way back works the same: the workspace checkout sends no tag.
      mark = calls.length
      pickRow('.gp-repolist__item', 'fixture-repo')
      await wait(700)
      observed.afterBack = { activeTab: activeTabLabel(), rows: listRows(), calls: calls.slice(mark) }
      return { observed, calls }
    }
    if (action === 'compact-groups') {
      // Compact hosts the list as a page of cards; two families split it into
      // sections, and the disabled cards keep their reason instead of dying.
      clickTab('tab.reposShort')
      await wait(300)
      observed.layout = document.querySelector('.gp-panel').getAttribute('data-layout')
      observed.activeTab = activeTabLabel()
      observed.groups = groupInfo()
      observed.cards = cardRows()
      const mark = calls.length
      pickRow('.gp-repos__item', 'gone')
      await wait(400)
      observed.disabledTap = {
        active: cardRows().map((card) => card.active),
        snapshots: calls.slice(mark).filter((call) => call.endpoint === 'gitPanel/snapshot'),
      }
      return { observed, calls }
    }
    if (action === 'reject') {
      // The pick names a checkout the host can no longer resolve: the sample
      // comes back as invalid-repo, and the panel has to return to the cwd
      // checkout instead of leaving every pane on an error page. The empty
      // slot is sampled while the repair runs, so the copy it used is known.
      const empties = []
      const sampleEmpty = () => {
        const node = document.querySelector('.gp-panel .gp-empty')
        const text = node === null ? '' : node.textContent.trim()
        if (text !== '' && !empties.includes(text)) empties.push(text)
      }
      const mark = calls.length
      await expandRepos()
      pickRow('.gp-repolist__item', 'site')
      for (let i = 0; i < 50; i += 1) { sampleEmpty(); await wait(24) }
      sampleEmpty()
      observed.rejected = {
        activeTab: activeTabLabel(),
        rows: listRows(),
        cards: cardRows(),
        empties: empties.slice(),
        calls: calls.slice(mark),
      }
      return { observed, calls }
    }
    if (action === 'files-only') {
      // No interaction yet: the default entered the first sub-repository, the
      // block boots collapsed naming it, and the list has no workspace-root row.
      observed.snapshotTags = calls.filter((call) => call.endpoint === 'gitPanel/snapshot').map((call) => call.repo)
      observed.optionRows = listRows().map((row) => row.name)
      observed.statusAfterPick = textOf(document, '.gp-panel .gp-files__statusbar .gp-files__status-code')
      // Boot, before any interaction: the collapsed block keeps its path line
      // behind [hidden], and the files page itself carries no repository entry.
      const bootRoot = document.querySelector('.gp-panel .gp-repolist__root')
      observed.rootHiddenAtBoot = bootRoot !== null && getComputedStyle(bootRoot).display === 'none'
      observed.filesEntries = document.querySelectorAll('.gp-panel .gp-files .gp-repolist, .gp-panel .gp-files .gp-repos').length
      // The expanded block's absolute path line: click-to-copy with ✓ (1.6 s).
      await expandRepos()
      observed.afterExpand = headInfo()
      observed.rootLine = textOf(document, '.gp-panel .gp-repolist__root')
      const shownRoot = document.querySelector('.gp-panel .gp-repolist__root')
      observed.rootShownAfterExpand = shownRoot !== null && getComputedStyle(shownRoot).display !== 'none'
      armClipboard('__copiedRoot')
      const rootBtn = document.querySelector('.gp-panel .gp-repolist__root')
      if (rootBtn !== null) rootBtn.click()
      await wait(80)
      observed.rootLineCopy = window.__copiedRoot
      observed.rootLineCopiedClass = document.querySelector('.gp-panel .gp-repolist__root')?.classList.contains('gp-repolist__root--copied') ?? false
      // The remembered pick holds; a re-fired default would sample the root again.
      const steadyMark = calls.length
      await wait(700)
      observed.steady = {
        head: headInfo(),
        newSnapshotTags: calls.slice(steadyMark).filter((call) => call.endpoint === 'gitPanel/snapshot').map((call) => call.repo),
      }
      // Tabs / status bar / repository rows, read for either landing state.
      observed.state = {
        tabs: tabLabels(),
        activeTab: activeTabLabel(),
        tabCount: document.querySelector('.gp-panel .gp-tabbar').getAttribute('data-tab-count'),
        statusbar: statusbarInfo(),
        switching: switchingNow(),
        repoRows: document.querySelectorAll('.gp-panel .gp-repolist__item, .gp-panel .gp-repos__item').length,
      }
      // The status bar path copies on the same pattern.
      armClipboard('__copiedStatus')
      const statusBtn = document.querySelector('.gp-panel .gp-files__status-path')
      if (statusBtn !== null) statusBtn.click()
      await wait(80)
      observed.statusPathCopy = window.__copiedStatus
      observed.statusPathCopiedClass = document.querySelector('.gp-panel .gp-files__status-path')?.classList.contains('gp-files__status-path--copied') ?? false
      return { observed, calls }
    }
    if (action === 'probe') {
      // The switch flips mid-run: the next polled snapshot carries the flag and
      // the list re-answers itself — no page switch, no reload.
      if (activeTabLabel() !== 'tab.overview') {
        clickTab('tab.overview')
        await wait(300)
      }
      observed.rowsBefore = listRows().map((row) => row.name)
      const mark = calls.length
      probe.off = true
      for (let i = 0; i < 80 && listRows().length >= 2; i += 1) await wait(50)
      await wait(400)
      observed.probeOff = {
        rows: listRows().map((row) => row.name),
        headPresent: headInfo().present,
        repoListCalls: calls.slice(mark).filter((call) => call.kind === 'repo-list').length,
        lastSnapshotTag: calls.filter((call) => call.endpoint === 'gitPanel/snapshot').map((call) => call.repo).at(-1),
      }
      return { observed, calls }
    }
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
    await expandRepos()
    observed.afterExpand = headInfo()
    pickRow('.gp-repolist__item', 'site')
    await wait(250)
    observed.duringSwitch = {
      switching: switchingNow(),
      badge: textOf(document.querySelector('.gp-panel .gp-tabbar'), '.gp-tabbar__switching'),
      inLeftColumn: listInLeftColumn(),
      rows: listRows(),
      tabCount: document.querySelector('.gp-panel .gp-tabbar').getAttribute('data-tab-count'),
    }
    if (typeof fixture.releaseSnapshot === 'function') fixture.releaseSnapshot()
    fixture.holdSnapshot = false
    await wait(700)
    observed.afterNested = {
      activeTab: activeTabLabel(), tabs: tabLabels(), inLeftColumn: listInLeftColumn(),
      rows: listRows(), switching: switchingNow(), calls: calls.slice(mark),
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
  }, { snap: snapUsed, repos, action, snapshotFails, scene, probeToggle: options.probeToggle === true })
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
    assert.equal(seen.head.expanded, false, 'the list block boots collapsed')
    assert.equal(seen.head.selected, 'fixture-repo', 'the collapsed head names the checkout in use')
    assert.equal(seen.afterExpand.expanded, true, 'the toggle expands the block')
    assert.deepEqual(seen.rows.map((row) => row.name), ['fixture-repo', 'site', 'web (apps/web)'], 'every checkout is listed')
    assert.deepEqual(seen.rows.map((row) => row.active), [true, false, false], 'the workspace checkout starts checked')
    assert.equal(seen.rows[1].meta, '', 'a folder that names the checkout needs no second line')
    assert.equal(seen.rows[2].meta, 'apps/web', 'a nested row carries its relative path')
    assert.equal(seen.rows[0].current, 'true')
    assert.ok(seen.rows[0].branch.includes('main'), 'the checked row reports its branch on the name line: ' + seen.rows[0].branch)
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
    // The scan answers "which repositories does this cwd offer", not "which one
    // is picked": a switch must not walk the tree again for an answer that has
    // already arrived.
    assert.equal(nestedCalls.filter((call) => call.kind === 'repo-list').length, 0, 'a switch does not re-scan the workspace')
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

// 4. A workspace directory that is not a checkout, holding two nested
// repositories. Entering one defaults straight in (no click): the three git
// panes come up on their own, the block boots collapsed naming it, and the
// list offers no workspace-root row. Expanding states the checkout's absolute
// path (click-to-copy); the remembered pick keeps every later sample tagged.
{
  const { out, errors } = await mount([NESTED_REPO, DEEP_REPO], 'files-only', { snapshotFails: true, scene: 'S4' })
  try {
    assert.equal(out.error, undefined, 'the panel mounted')
    const seen = out.observed
    // The default entered the checkout without any interaction.
    assert.deepEqual(seen.tabs, ['tab.overview', 'tab.changes', 'tab.files'], 'the sub-repository brings the git panes up on its own')
    assert.equal(seen.tabCount, '3', 'the bar reports all three pages')
    assert.equal(seen.activeTab, 'tab.overview', 'and the overview is what opens')
    assert.equal(seen.filesEntries, 0, 'the files page carries no repository entry')
    assert.equal(seen.head.present, true, 'the overview carries the repository block')
    assert.equal(seen.head.expanded, false, 'the block boots collapsed')
    assert.equal(seen.rootHiddenAtBoot, true, 'the collapsed block keeps its path line hidden')
    assert.equal(seen.head.selected, 'site', 'the collapsed head names the checkout in use')
    assert.deepEqual(seen.optionRows, ['site', 'web (apps/web)'], 'the list offers only real checkouts: no workspace-root row')
    const tags = seen.snapshotTags
    assert.ok(tags.includes(''), 'the root was sampled first (and failed): ' + JSON.stringify(tags))
    assert.ok(tags.includes('site'), 'the default then sampled the sub-repository: ' + JSON.stringify(tags))
    assert.equal(seen.statusAfterPick, 'fixture-repo/site', 'the status bar follows the checkout that is now sampled')
    assert.equal(seen.afterExpand.expanded, true, 'the block expands')
    assert.equal(seen.rootLine, 'fixture-repo/site', 'the expanded block states the checkout root')
    assert.equal(seen.rootShownAfterExpand, true, 'and shows that path line again once expanded')
    assert.equal(seen.rootLineCopy, 'fixture-repo/site', 'clicking the path line writes it to the clipboard')
    assert.equal(seen.rootLineCopiedClass, true, 'and confirms on the button')
    assert.ok(seen.steady.newSnapshotTags.every((tag) => tag === 'site'), 'the default never re-samples the root: ' + JSON.stringify(seen.steady.newSnapshotTags))
    const snapTags = out.calls.filter((call) => call.endpoint === 'gitPanel/snapshot').map((call) => call.repo)
    assert.ok(!snapTags.slice(snapTags.indexOf('site')).includes(''), 'once the pick landed no sample walks back to the root: ' + JSON.stringify(snapTags))
    assert.equal(seen.steady.head.expanded, true, 'the block stays where it was left')
    assert.equal(seen.state.activeTab, 'tab.overview', 'the panel stays on the overview')
    assert.equal(seen.state.switching, false, 'and settled')
    assert.equal(seen.statusPathCopy, 'fixture-repo/site', 'clicking the status path writes it to the clipboard')
    assert.equal(seen.statusPathCopiedClass, true, 'and confirms on the button')
    assert.deepEqual(errors, [], 'no page errors: ' + JSON.stringify(errors))
  } catch (error) {
    console.error('non-checkout observation: ' + JSON.stringify({ observed: out.observed, calls: out.calls, errors }))
    failures.push(error)
  }
}

// 4b. The same directory with nothing to scan: the browser alone is the page —
// one tab, no repository rows — and the status bar roots itself at the cwd
// (absolute path + refresh, as the tree column's header).
{
  const { out, errors } = await mount([], 'files-only', { snapshotFails: true, scene: 'S4b' })
  try {
    assert.equal(out.error, undefined, 'the panel mounted')
    const seen = out.observed
    assert.deepEqual(seen.tabs, ['tab.files'], 'with nothing to scan the browser is the only page')
    assert.equal(seen.activeTab, 'tab.files', 'and that is the page that opens')
    assert.equal(seen.state.tabCount, '1', 'the bar reports the single page')
    assert.equal(seen.head.present, false, 'no list block renders')
    assert.equal(seen.state.repoRows, 0, 'and no repository rows in any form: the browser alone is the page')
    assert.equal(seen.optionRows.length, 0, 'the list offers no rows')
    assert.equal(seen.rootLine, '', 'and states no checkout path')
    assert.equal(seen.rootLineCopy, null, 'nothing was copied')
    assert.equal(seen.state.switching, false, 'the panel settled')
    assert.equal(seen.state.statusbar.present, true, 'the files page carries a status bar')
    assert.equal(seen.state.statusbar.hasPath, true, 'with the browse root on it')
    assert.equal(seen.state.statusbar.path, '/mock/workspace', 'the degrade shows the cwd it is rooted at')
    assert.equal(seen.state.statusbar.refreshInBar, true, 'the refresh control lives in the bar')
    assert.equal(seen.state.statusbar.barInTree, true, 'the bar is the tree column header, not a full-width row on top of the page')
    assert.equal(seen.state.statusbar.precedesRows, true, 'and it stands above the file entries, outside the scrolling list')
    assert.equal(seen.state.statusbar.spansColumnOnly, true, 'the bar only spans the tree column, never the preview side')
    assert.equal(seen.statusPathCopy, '/mock/workspace', 'clicking the status path writes it to the clipboard')
    assert.equal(seen.statusPathCopiedClass, true, 'and confirms on the button')
    assert.deepEqual(errors, [], 'no page errors: ' + JSON.stringify(errors))
  } catch (error) {
    console.error('plain-browser observation: ' + JSON.stringify({ observed: out.observed, calls: out.calls, errors }))
    failures.push(error)
  }
}

// 5. The compact layout has no left column, so the list becomes a page of its
// own — and the tab bar's indicator has to follow the fourth cell that page
// adds, while the panes behind it stay quiet.
{
  const { out, errors } = await mount([WORKSPACE_REPO, NESTED_REPO], 'compact', { panelWidth: 360, viewportWidth: 360 })
  try {
    assert.equal(out.error, undefined, 'the panel mounted')
    const seen = out.observed
    assert.equal(seen.layout, 'compact', 'a 360px panel is the compact layout')
    assert.deepEqual(seen.tabs, ['tab.reposShort', 'tab.overviewShort', 'tab.changesShort', 'tab.filesShort'], 'the picker leads the compact bar')
    assert.equal(seen.tabCount, '4', 'and the bar reports four cells')
    assert.ok(seen.indicator !== null, 'the bar draws an indicator')
    // (100% - 4px) / 4, the compact override's divisor: a hard-coded three would
    // slide the pill off the cell of the page it names.
    assert.ok(Math.abs(seen.indicator.width - (seen.indicator.track - 4) / 4) < 2, 'the indicator takes a quarter of the track: ' + JSON.stringify(seen.indicator))
    assert.equal(seen.activeTab, 'tab.overviewShort', 'the overview still opens first')
    assert.equal(seen.picker.activeTab, 'tab.reposShort', 'a tap on the first tab opens the picker')
    assert.deepEqual(seen.picker.cards.map((row) => row.name), ['fixture-repo', 'site'], 'every checkout is carded')
    assert.deepEqual(seen.picker.cards.map((row) => row.active), [true, false], 'the workspace checkout starts checked')
    // The overview is behind the picker rather than on screen, so it must not
    // keep querying for a page nobody is looking at.
    assert.deepEqual(seen.idleKinds, [], 'no pane behind the picker starts a query')
    assert.equal(seen.afterPick.activeTab, 'tab.reposShort', 'a pick in the compact layout stays on the picker')
    assert.deepEqual(seen.afterPick.cards.map((row) => row.active), [false, true], 'and marks the picked checkout')
    // `repo-list` is the one query that spans the whole workspace, so it stays
    // untagged; everything else has to follow the pick.
    const scoped = seen.afterPick.calls.filter((call) => call.kind !== 'repo-list')
    assert.ok(scoped.some((call) => call.endpoint === 'gitPanel/snapshot'), 'the pick refetched a snapshot')
    assert.ok(scoped.every((call) => call.repo === 'site'), 'every repository-scoped request carries the pick: ' + JSON.stringify(seen.afterPick.calls))
    assert.deepEqual(errors, [], 'no page errors: ' + JSON.stringify(errors))
  } catch (error) {
    console.error('compact observation: ' + JSON.stringify({ observed: out.observed, calls: out.calls, errors }))
    failures.push(error)
  }
}

// 6. A pick the host can no longer resolve (the checkout was deleted, or it
// stopped being a work-tree top) must not strand the panel on an error page:
// the selection falls back to the cwd checkout, the page stays put, and the
// copy never blames a missing git.
{
  const { out, errors } = await mount([WORKSPACE_REPO, NESTED_REPO], 'reject', { snapshotFails: 'invalid-repo', scene: 'S6' })
  try {
    assert.equal(out.error, undefined, 'the panel mounted')
    const seen = out.observed
    assert.deepEqual(seen.rows.map((row) => row.name), ['fixture-repo', 'site'], 'both checkouts are listed')
    const rejected = seen.rejected
    assert.deepEqual(rejected.rows.map((row) => row.active), [true, false], 'the rejected pick falls back to the workspace checkout')
    assert.equal(rejected.activeTab, 'tab.overview', 'a repair is not a navigation: the page stays')
    assert.equal(rejected.empties.includes('pill.unavailable'), false, 'a stale pick is never reported as a missing git: ' + JSON.stringify(rejected.empties))
    assert.equal(seen.tabCount, '3', 'a rejected pick does not collapse the bar into the browser')
    const tags = rejected.calls.filter((call) => call.endpoint === 'gitPanel/snapshot').map((call) => call.repo)
    assert.ok(tags.includes('site'), 'the rejected pick was sampled: ' + JSON.stringify(tags))
    assert.ok(tags.slice(tags.indexOf('site')).includes(''), 'the workspace checkout was sampled again: ' + JSON.stringify(tags))
    assert.equal(tags[tags.length - 1], '', 'and the panel settles on it: ' + JSON.stringify(tags))
    assert.deepEqual(errors, [], 'no page errors: ' + JSON.stringify(errors))
  } catch (error) {
    console.error('rejected pick observation: ' + JSON.stringify({ observed: out.observed, calls: out.calls, errors }))
    failures.push(error)
  }
}

// 7. A repository family with worktrees beside unrelated repositories: two
// groups with their own headers and counts, the family's branches on every
// row, disabled rows that say why — and are inert — and a worktree pick that
// rides every repository-scoped request like any other checkout.
{
  const { out, errors } = await mount(MIXED_FAMILY, 'worktree', { scene: 'S7' })
  try {
    assert.equal(out.error, undefined, 'the panel mounted')
    const seen = out.observed
    assert.deepEqual(seen.groups.titles, ['repos.group.own', 'repos.group.foreign'], 'two families earn two headers')
    assert.deepEqual(seen.groups.labels, ['repos.group.own', 'repos.group.foreign'], 'each group names itself')
    assert.deepEqual(seen.groups.counts, ['2/4', '2'], 'the family header shows choosable/total, the flat one just the total')
    assert.deepEqual(seen.rows.map((row) => row.name), ['fixture-repo', 'sidebar', 'spike', 'gone', 'site', 'web (apps/web)'], 'family rows lead, the workspace follows')
    assert.deepEqual(seen.rows.map((row) => row.branch), ['main', 'feat/sidebar', 'spike', 'old', '', ''], 'every family row prints the branch git reported; foreign rows claim none')
    assert.deepEqual(seen.rows.map((row) => row.disabled), [false, false, true, true, false, false], 'outside and lost directories are visible but unchoosable')
    assert.equal(seen.rows.length, 6, 'four family rows and two foreign rows')
    assert.equal(seen.rows[0].meta, 'repos.mainTag', 'the main work tree declares itself with its badge')
    assert.equal(seen.rows[2].title, 'repos.disabled.outside', 'and the reason is on the row itself')
    assert.equal(seen.rows[3].title, 'repos.disabled.stale', 'a lost directory names its cleanup')
    // The disabled rows must be inert: no request, no switch, no movement.
    assert.equal(seen.disabledTap.switching, false, 'a disabled row never starts a switch')
    assert.deepEqual(seen.disabledTap.active, [true, false, false, false, false, false], 'the selection does not move')
    assert.deepEqual(seen.disabledTap.snapshots, [], 'and no sample is even requested')
    // The worktree pick rides the wire, exactly like a nested repository pick.
    const scoped = (calls) => calls.filter((call) => call.kind !== 'repo-list')
    assert.ok(scoped(seen.afterPick.calls).length > 0, 'the worktree pick fetched: ' + JSON.stringify(seen.afterPick.calls))
    assert.ok(scoped(seen.afterPick.calls).every((call) => call.repo === '.agents/worktrees/feat/sidebar'), 'every repository-scoped request carries the worktree: ' + JSON.stringify(seen.afterPick.calls))
    assert.equal(seen.afterPick.rows.find((row) => row.name === 'sidebar').active, true, 'the worktree row is checked')
    assert.equal(seen.afterPick.activeTab, 'tab.overview', 'picking a worktree stays on the overview')
    assert.equal(seen.afterPick.switching, false, 'the switch completes')
    assert.ok(scoped(seen.afterBack.calls).every((call) => call.repo === ''), 'the way back sends no tag: ' + JSON.stringify(seen.afterBack.calls))
    assert.equal(seen.afterBack.rows[0].active, true, 'and the workspace checkout is checked again')
    assert.deepEqual(errors, [], 'no page errors: ' + JSON.stringify(errors))
  } catch (error) {
    console.error('worktree observation: ' + JSON.stringify({ observed: out.observed, calls: out.calls, errors }))
    failures.push(error)
  }
}

// 8. The compact layout carries the same families as sections of cards, with
// the disabled cards greyed and their reason on the card — and a tap on one of
// them must be as inert as in the overview.
{
  const { out, errors } = await mount(MIXED_FAMILY, 'compact-groups', { panelWidth: 360, viewportWidth: 360, scene: 'S8' })
  try {
    assert.equal(out.error, undefined, 'the panel mounted')
    const seen = out.observed
    assert.equal(seen.layout, 'compact', 'a 360px panel is the compact layout')
    assert.equal(seen.activeTab, 'tab.reposShort', 'and it opens on the cards')
    assert.deepEqual(seen.groups.cardTitles, ['repos.group.own', 'repos.group.foreign'], 'the cards split into one section per family')
    assert.deepEqual(seen.groups.cardCounts, ['2/4', '2'], 'each section counts its choosable cards')
    assert.deepEqual(seen.cards.map((card) => card.name), ['fixture-repo', 'sidebar', 'spike', 'gone', 'site', 'web (apps/web)'], 'every checkout is carded, family first')
    assert.deepEqual(seen.cards.map((card) => card.disabled), [false, false, true, true, false, false], 'the two disabled worktrees stay visible but dead')
    assert.equal(seen.cards[2].path, 'repos.disabled.outside', 'an outside worktree states its reason on the card')
    assert.equal(seen.cards[3].path, 'repos.disabled.stale', 'and a lost one names its cleanup')
    assert.deepEqual(seen.disabledTap.active, [true, false, false, false, false, false], 'a tap on a disabled card changes nothing')
    assert.deepEqual(seen.disabledTap.snapshots, [], 'and asks for nothing')
    assert.deepEqual(errors, [], 'no page errors: ' + JSON.stringify(errors))
  } catch (error) {
    console.error('compact-groups observation: ' + JSON.stringify({ observed: out.observed, calls: out.calls, errors }))
    failures.push(error)
  }
}

// 9. The probe switch re-answers the list in place: flipping it off (as the
// config form does) empties the list — one checkout needs no list — and drops
// the stale sub-repository pick, without any page switch or reload.
{
  const { out, errors } = await mount([WORKSPACE_REPO, NESTED_REPO], 'probe', { pollMs: 500, probeToggle: true, scene: 'S9' })
  try {
    assert.equal(out.error, undefined, 'the panel mounted')
    const seen = out.observed
    assert.deepEqual(seen.rowsBefore, ['fixture-repo', 'site'], 'both checkouts are listed while the probe is on')
    assert.ok(seen.probeOff.repoListCalls > 0, 'the list was re-answered after the flip')
    assert.deepEqual(seen.probeOff.rows, [], 'one checkout needs no list')
    assert.equal(seen.probeOff.headPresent, false, 'the block unmounts with it')
    assert.equal(seen.probeOff.lastSnapshotTag, '', 'the stale sub-repository pick fell back to the workspace')
    assert.deepEqual(errors, [], 'no page errors: ' + JSON.stringify(errors))
  } catch (error) {
    console.error('probe-toggle observation: ' + JSON.stringify({ observed: out.observed, calls: out.calls, errors }))
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
