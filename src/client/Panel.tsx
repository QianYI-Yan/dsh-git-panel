/**
 * Main Git panel shell: Repositories / Overview / Changes / Files over the
 * conversation.view slot. Snapshot state chooses the initial tab unless the
 * input-bar pill supplied a one-shot focus request; the Repositories tab leads
 * the bar whenever the workspace scan returns a checkout to pick from.
 *
 * Repositories is a dock of the overview rather than a fourth page: picking a
 * checkout splits the overview (the panes above, the list below, like an
 * editor's source-control view), and the Overview tab closes the dock again.
 * Only a cwd with no checkout of its own gives the list a page of its own,
 * because there is nothing to split there.
 */
import { createElement as h, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { SegmentedTabs, type SegmentedTab } from '@deepseek-ai/dsh-client-ui-primitives'
import { gitPanelRemoteOf, hasSession, queryAs, type ClientCtx, type GitPanelRemote } from './rpc.js'
import { useGitView, controllerFor } from './registry.js'
import { takeSubTab, subscribeSubTab, stashSubTab, recentSubTab, type SubTab } from './jump.js'
import { OverviewTab } from './OverviewTab.js'
import { ChangesTab } from './ChangesTab.js'
import { FilesTab } from './FilesTab.js'
import { ReposTab } from './ReposTab.js'
import { repoChoices } from './repo-list.js'
import { CommitIcon, DiffIcon, FilesIcon, RefreshIcon, RepoIcon, StarIcon } from './icons.js'
import { usePanelLayout } from './layout.js'
import { isCramped, panelMode, STACKED_TIGHT_BP } from './panel-fit.js'
import { useHoverTip } from './tip.js'
import { hasConfigForms, writePanelConfigField } from './config-write.js'
import type { FontDelta, GitAction, GitRepoEntry, GitVersionInfo } from './types.js'
import type { GitKey } from './locales.js'
import { opErrorText } from './ops-modals.js'
import { NoticeBar } from './notice.js'
import { usePageVisibility } from './use-page-visibility.js'
import { selectedRepo, selectRepo, withRepo } from './repo-select.js'

function coerceFontDelta(value: unknown): FontDelta {
  return value === -1 || value === 1 ? value : 0
}

/** Pre-migration localStorage key for the panel font step (removed from the
 * write path when fontDelta moved into the host config). */
const LEGACY_FONT_KEY = 'gp.panel.fontDelta'

interface PanelProps {
  readonly ctx: ClientCtx
  readonly sessionId?: string
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
  /** Where the panel is mounted. The sidebar has no composer under it, so the
   * conversation view's overlay mode and its reserved height do not apply. */
  readonly host?: 'conversation' | 'sidebar'
  /** Whether the mounting surface is currently on screen. The sidebar reports
   * its own tab's visibility, so a hidden tab starts no queries. */
  readonly visible?: boolean
}

export function Panel({ ctx, sessionId, t, host = 'conversation', visible }: PanelProps): JSX.Element {
  const pageVisible = usePageVisibility()
  const [fontPending, setFontPending] = useState<FontDelta | null>(null)
  // Monotonic token for the latest font write: a slow host set for an older
  // click must not clear (or race) a newer pending step.
  const fontWriteGen = useRef(0)
  const [selection, setSelection] = useState<{ sessionId: string; tab: SubTab } | null>(null)
  const [rootEl, setRootEl] = useState<HTMLElement | null>(null)
  // Compact layout kicks in on a narrow panel (phone / squeezed split): the
  // three-column tabs collapse to single-column drill-in. Width-driven, so it
  // recovers the full layout as soon as the panel widens.
  const layout = usePanelLayout(rootEl)
  // The mode folds the width/height facts with the mount point: a tall narrow
  // right sidebar stacks its panes (PC height, no drilling), while phones and
  // squeezed conversation columns drill exactly as before (panel-fit.ts).
  const mode = panelMode(layout, host)
  const compact = mode === 'compact'
  const stacked = mode === 'stacked'
  // A sidebar dragged to its minimum cannot host the full tab labels plus the
  // font stepper; it drops to the phone's treatment instead (short labels,
  // stepper hidden). Below the threshold the row reads crushed, not merely
  // clipped — flex absorbs the width without any overflow to detect.
  const stackedTight = stacked && layout.width > 0 && layout.width <= STACKED_TIGHT_BP
  const shortLabels = compact || stackedTight
  // Narrow AND short is the only case that trades content away for room (the
  // commit editor's fold, the change timestamps): a big screen whose column a
  // sidebar narrowed keeps them, because it has the height to spare.
  const cramped = isCramped(layout)
  const view = useGitView(sessionId)
  const remote = gitPanelRemoteOf(ctx)
  // The font stepper writes through the settings form; without it the control
  // would silently no-op, so it is not rendered at all.
  const fontWritable = hasConfigForms(ctx)
  // git not installed degrades to the file browser too; inside a repo we add a
  // notice, outside one it is a silent fallback (same as not-a-git-repo).
  const gitUnavailable = view.state === 'error' && view.error.code === 'git-unavailable'
  const filesOnly = view.state === 'error' && (view.error.code === 'not-a-git-repo' || view.error.code === 'git-unavailable')
  const gitMissingInRepo = gitUnavailable && view.state === 'error' && view.error.isGitRepo === true
  // Wait for the snapshot before mounting any git-backed pane. An explicit pill
  // jump takes priority; switching sessions resets the one-shot default.
  const pickedTab = selection !== null && selection.sessionId === sessionId ? selection.tab : null
  // A cwd that is not a checkout keeps the Repositories tab: the nested
  // repositories it lists are the only way to reach any git view at all.
  const activeTab: SubTab | null = filesOnly && pickedTab !== 'repos' ? 'files' : pickedTab
  const visited = useRef<{ sessionId?: string; tabs: Set<SubTab> }>({ tabs: new Set() })
  if (visited.current.sessionId !== sessionId) visited.current = { sessionId, tabs: new Set() }
  if (activeTab !== null) visited.current.tabs.add(activeTab)
  const filesVisited = visited.current.tabs.has('files')

  useEffect(() => {
    if (!hasSession(sessionId)) return
    if (filesOnly) {
      // Only Repositories and Files exist here; an explicit pick of either is
      // already the answer, anything else lands on the browser as before.
      if (selection?.sessionId === sessionId && (selection.tab === 'repos' || selection.tab === 'files')) return
      setSelection({ sessionId, tab: 'files' })
      return
    }
    if (selection?.sessionId === sessionId) return
    const pending = takeSubTab(sessionId)
    if (pending !== null) { setSelection({ sessionId, tab: pending }); return }
    // A quick return (within the sticky window) restores the last sub-tab
    // instead of recomputing the default entry; an explicit pill jump above
    // still wins.
    const recent = recentSubTab(sessionId)
    if (recent !== null) { setSelection({ sessionId, tab: recent }); return }
    if (view.state === 'ready') setSelection({ sessionId, tab: view.snapshot.dirty ? 'changes' : 'overview' })
  }, [sessionId, view, filesOnly, selection?.sessionId, selection?.tab])

  // While mounted, receive pill jumps live (a click when the panel is already
  // visible must still switch sub-tabs, not sit in the pending map).
  useEffect(() => {
    if (!hasSession(sessionId)) return
    return subscribeSubTab(sessionId, (requested) => setSelection({ sessionId, tab: requested }))
  }, [sessionId])

  // Stash the sub-tab the panel is leaving on so a quick return restores it.
  // A ref carries the latest value into the unmount-only cleanup.
  const leavingRef = useRef<{ sessionId?: string; tab: SubTab | null }>({ tab: null })
  leavingRef.current = { sessionId, tab: activeTab }
  useEffect(() => () => {
    const { sessionId: sid, tab } = leavingRef.current
    if (sid !== undefined && tab !== null) stashSubTab(sid, tab)
  }, [])

  // Visible leaf tabs subscribe to query ticks and the restore gate themselves;
  // a same-fingerprint catch-up must not require a Panel business notification.
  // In the sidebar the mount is only on screen while its tab is selected, so the
  // host's own visibility gates the queries too.
  const queryVisible = pageVisible && hasSession(sessionId) && visible !== false

  // Work-tree generation: bumped whenever the *contents* of the work tree are
  // replaced wholesale — a branch switch, or a switch that stashed the local
  // changes first (which removes files even when the checkout then fails). The
  // Files tab keeps a per-session directory cache that would otherwise serve
  // the previous branch's tree for up to a minute; this tells it to drop it.
  const [worktreeGen, setWorktreeGen] = useState(0)
  // The git-not-installed banner can be dismissed for this mount.
  const [gitNoticeClosed, setGitNoticeClosed] = useState(false)

  // Repository selection: '' follows the repository the session cwd belongs to
  // (walk-up), anything else follows a nested repository below that cwd. The
  // pick is remembered per session (repo-select.ts); carrying a state pair lets
  // a session switch derive the new session's pick instead of showing the
  // previous session's repository for one render.
  const [repos, setRepos] = useState<readonly GitRepoEntry[]>([])
  const [repoState, setRepoState] = useState<{ readonly session?: string; readonly path: string }>({
    session: sessionId,
    path: sessionId === undefined ? '' : selectedRepo(sessionId),
  })
  const repo = repoState.session === sessionId
    ? repoState.path
    : sessionId === undefined ? '' : selectedRepo(sessionId)
  // The list belongs to one session's cwd: drop it when the session changes so
  // the switcher cannot offer the previous workspace's repositories.
  useEffect(() => { setRepos([]) }, [sessionId])
  const snapshotRoot = view.state === 'ready' ? view.snapshot.root : ''
  // Every repository-scoped call of the panes and of the write path goes
  // through this face: the tabs stay unaware of the selection.
  const repoRemote = useMemo(() => withRepo(remote, repo), [remote, repo])
  // The controller samples exactly one repository; keep it aligned with the
  // switcher. setRepo() publishes the loading state itself, so no pane keeps
  // reading the previous work tree's snapshot under the new selection.
  useEffect(() => {
    if (!hasSession(sessionId)) return
    const controller = controllerFor(sessionId)
    if (controller.getRepo() === repo) return
    void controller.setRepo(repo)
  }, [sessionId, repo])

  const chooseRepo = (next: string): void => {
    if (!hasSession(sessionId) || next === repo) return
    selectRepo(sessionId, next)
    setRepoState({ session: sessionId, path: next })
    // Another repository means another directory tree: drop the Files cache.
    setWorktreeGen((n) => n + 1)
    // Land where the new checkout has something to say. The workspace-root
    // entry of a non-checkout cwd is not in the scan (it has no checkout), so it
    // opens the browser instead of a git view that cannot resolve.
    const target = repos.find((entry) => entry.path === next)
    // Switching stays put: the overview (its left column holds the list) where
    // there is one, the Repositories tab in the compact layout. An entry with no
    // checkout behind it — the workspace root of a non-checkout cwd — opens the
    // browser instead.
    const stay: SubTab = compact ? 'repos' : 'overview'
    setSelection({ sessionId, tab: target !== undefined ? stay : 'files' })
  }

  useEffect(() => {
    if (!queryVisible) return
    let alive = true
    void (async () => {
      const listed = queryAs(
        await remote.query({ sessionId: sessionId as string, query: { kind: 'repo-list' } }),
        'repo-list',
      )
      if (!alive || listed === null) return
      // A reply without the list (an older host) degrades to "one repository"
      // rather than blanking the tab bar on a missing field.
      const found = Array.isArray(listed.repos) ? listed.repos : []
      setRepos(found)
      // A remembered pick that disappeared (deleted, or no longer a repository)
      // falls back to the cwd's own repository instead of erroring forever.
      if (repo !== '' && !found.some((entry) => entry.path === repo)) chooseRepo('')
    })()
    return () => { alive = false }
    // chooseRepo is rebuilt every render; the query only depends on its inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote, sessionId, queryVisible, snapshotRoot, repo])

  const onAction = async (action: GitAction): Promise<{ ok: boolean; error?: string }> => {
    if (!hasSession(sessionId)) return { ok: false, error: t('error.noCwd') }
    // The selection can move while the write is in flight; the reply carries a
    // snapshot of the work tree it started in. Handing that to a controller
    // that already switched repositories would both paint the old tree and
    // bump the generation, discarding the refresh the switch had started.
    const startedRepo = repo
    const result = await repoRemote.run({ sessionId, action })
    if (result.ok) {
      const controller = controllerFor(sessionId)
      if (controller.getRepo() !== startedRepo) {
        void controller.refresh()
        return { ok: true }
      }
      // The run already returned a fresh snapshot; feed it to the controller
      // instead of triggering another git round-trip.
      controller.accept(result.snapshot)
      if (action.kind === 'branch-checkout') setWorktreeGen((n) => n + 1)
      return { ok: true }
    }
    // A failed write may still have changed the work tree (e.g. a stash pop that
    // hit a conflict applies the diff but keeps the stash); resync so the panel
    // reflects the real state rather than the pre-action snapshot.
    if (action.kind === 'branch-checkout' && action.stashMessage !== undefined) setWorktreeGen((n) => n + 1)
    controllerFor(sessionId).resync()
    return { ok: false, error: opErrorText(result.error.code, result.error.message, t) }
  }

  const adjustFont = (delta: FontDelta): void => {
    if (delta === fontDelta) return
    const gen = ++fontWriteGen.current
    setFontPending(delta)
    void writePanelConfigField(ctx, 'fontDelta', delta).then((ok) => {
      // Ignore a write that lost the race to a newer click. A failed write
      // drops the optimistic step; a successful one keeps it until the
      // resynced snapshot catches up (effect below).
      if (fontWriteGen.current !== gen) return
      if (!ok) setFontPending(null)
    })
  }

  // Font step lives in the host config and rides every snapshot; a pending
  // write shows optimistically until the resync lands.
  const snapFont = view.state === 'ready' ? coerceFontDelta(view.snapshot.fontDelta) : 0
  const fontDelta = fontPending ?? snapFont
  useEffect(() => {
    if (fontPending !== null && snapFont === fontPending) setFontPending(null)
  }, [snapFont, fontPending])

  // One-shot bootstrap: a pre-migration localStorage step is written into the
  // host config (only while the config still reads the default) and the key is
  // dropped so a later reset is not resurrected from storage.
  const fontMigrated = useRef(false)
  useEffect(() => {
    if (fontMigrated.current || view.state !== 'ready' || snapFont !== 0) return
    if (typeof localStorage === 'undefined') return
    const raw = localStorage.getItem(LEGACY_FONT_KEY)
    if (raw === null) return
    const legacy = coerceFontDelta(Number(raw))
    localStorage.removeItem(LEGACY_FONT_KEY)
    if (legacy === 0) return
    fontMigrated.current = true
    void writePanelConfigField(ctx, 'fontDelta', legacy)
  }, [ctx, view, snapFont])

  // Wide keeps the long labels; compact (phone / squeezed) and a minimum-width
  // stacked sidebar show the short pair so the three cells still read as words
  // next to the trailing controls.
  const tabLabelKeys: Record<SubTab, { full: GitKey; short: GitKey }> = {
    repos: { full: 'tab.repos', short: 'tab.reposShort' },
    overview: { full: 'tab.overview', short: 'tab.overviewShort' },
    changes: { full: 'tab.changes', short: 'tab.changesShort' },
    files: { full: 'tab.files', short: 'tab.filesShort' },
  }
  const tabIcons: Record<SubTab, JSX.Element> = {
    repos: h(RepoIcon, { size: 14 }),
    overview: h(CommitIcon, { size: 14 }),
    changes: h(DiffIcon, { size: 14 }),
    files: h(FilesIcon, { size: 14 }),
  }
  const repoList = repoChoices(repos)
  // A wide or stacked panel hosts the repository list in the overview's left
  // column, so it needs no tab for it: picking a checkout keeps the branches,
  // the commit list and the list itself on screen at once. The compact layout
  // has no left column, and a cwd that is not a checkout has no overview to put
  // one in — both keep the tab.
  const reposTab = repoList.length > 0 && (compact || filesOnly)
  const tabOrder: SubTab[] = reposTab
    ? ['repos', 'overview', 'changes', 'files']
    : ['overview', 'changes', 'files']
  const allTabs: Array<{ key: SubTab; label: string; icon: JSX.Element }> = tabOrder.map((key) => ({
    key,
    label: t(shortLabels ? tabLabelKeys[key].short : tabLabelKeys[key].full),
    icon: tabIcons[key],
  }))
  // A non-git directory exposes the browser — and the picker, which is the only
  // way to reach a repository that lives below that directory.
  const tabs = filesOnly ? allTabs.filter((tb) => tb.key === 'files' || tb.key === 'repos') : allTabs
  // The switcher is the platform SegmentedTabs primitive: it owns the tablist
  // role, the sliding indicator and the keyboard walk; we own the panes and
  // wire them up with instance-scoped ids (a panel can be mounted per session).
  const tabsId = useId()
  const tabItems: Array<SegmentedTab> = tabs.map((tb) => ({
    value: tb.key,
    label: [
      h('span', { key: 'i', className: 'gp-tab__icon' }, tb.icon),
      h('span', { key: 'l', className: 'gp-tab__label' }, tb.label),
    ],
    id: `${tabsId}-${tb.key}`,
    panelId: `${tabsId}-${tb.key}-panel`,
  }))
  // SegmentedTabs requires the value to belong to items; before a snapshot lands
  // (cold/loading/no-cwd) there is no active pane, so show the first tab.
  const selectedTab: SubTab = activeTab ?? tabs[0]?.key ?? 'overview'

  // Every tab in `tabs` always gets its own role=tabpanel node — in the ready
  // view and in the loading / no-cwd / error / files-only states alike — so a
  // tab's aria-controls never dangles. While the body is a placeholder it lives
  // in the selected pane; pane *content* still mounts on first visit.
  const placeholder: JSX.Element | null = ((): JSX.Element | null => {
    if (!hasSession(sessionId) || view.state === 'no-cwd') return h('div', { className: 'gp-empty' }, t('error.noCwd'))
    if (filesOnly) return null
    if (view.state === 'error') return h('div', { className: 'gp-empty' }, t('pill.unavailable'))
    if (view.state === 'cold' || view.state === 'loading' || activeTab === null) return h('div', { className: 'gp-empty' }, t('common.loading'))
    return null
  })()

  // The picker renders ahead of the state placeholder: it reads the scan
  // result and the one snapshot, needs neither a resolvable checkout nor a
  // finished sample, and is the way out of a cwd that has no git view — in
  // particular while the sample of a just-picked repository is still pending.
  const reposPane = (): JSX.Element | null => hasSession(sessionId)
    ? h(ReposTab, {
      key: 'repos',
      choices: repoList,
      current: repo,
      snapshot: view.state === 'ready' ? view.snapshot : null,
      compact,
      onChoose: chooseRepo,
      t,
    })
    : null

  // The overview owns the repository list: it renders it in its left column,
  // above the branch tree, so the two never alternate on screen.
  const overviewPane = (): JSX.Element | null => {
    const live = hasSession(sessionId) ? sessionId : undefined
    const snapshot = live !== undefined && view.state === 'ready' ? view.snapshot : null
    const mounted = snapshot !== null && visited.current.tabs.has('overview')
    const overview = mounted && snapshot !== null && live !== undefined
      ? h(OverviewTab, {
      key: live,
      remote: repoRemote,
      sessionId: live,
      // The overview is on screen in both of its tabs, so both keep it live; the
      // docked list only reads the scan and the one snapshot.
      visible: queryVisible && (activeTab === 'overview' || activeTab === 'repos'),
      defaultDiffView: snapshot.defaultDiffView,
      snapshot,
      onAction,
      onResync: () => controllerFor(live).resync(),
      compact,
      stacked,
      tight: stackedTight,
      phone: layout.phone ?? false,
      repositories: hasSession(sessionId) ? {
        choices: repoList,
        current: repo,
        onChoose: chooseRepo,
      } : undefined,
      t,
      })
      : undefined
    return overview ?? placeholder
  }

  const paneOwner = (key: SubTab): boolean => key === selectedTab

  const paneContent = (key: SubTab): JSX.Element | null => {
    // The picker reads the scan and the one snapshot, so it renders ahead of the
    // state placeholder; the wide layout reaches it through the overview instead.
    if (key === 'repos' && hasSession(sessionId)) return reposPane()
    if (key === 'overview') return overviewPane()
    // The state placeholder (loading / no-cwd / error, including no-session)
    // lives in the selected pane; the guard below only narrows sessionId for the
    // tab components.
    if (placeholder !== null) return paneOwner(key) ? placeholder : null
    if (!hasSession(sessionId)) return null
    // A non-git directory still browses files (host resolves the cwd as root).
    if (filesOnly) {
      return filesVisited ? h(FilesTab, { key: sessionId, remote: repoRemote, sessionId, compact, stacked, worktreeGen, snapshot: null, t }) : null
    }
    if (view.state !== 'ready') return null
    const snapshot = view.snapshot
    if (key === 'changes') {
      return visited.current.tabs.has('changes')
        ? h(ChangesTab, { key: sessionId, remote: repoRemote, sessionId, visible: queryVisible && activeTab === 'changes', snapshot, onAction, onRefresh: () => controllerFor(sessionId).refresh(), onSetFullChanges: (full) => controllerFor(sessionId).setFullChanges(full), compact, stacked, cramped, t })
        : null
    }
    // Files tab mounts on first visit (keeps cold cost zero — no dir-list
    // until the user opens it), then stays mounted to retain its tree state.
    return filesVisited ? h(FilesTab, { key: sessionId, remote: repoRemote, sessionId, compact, stacked, worktreeGen, snapshot, t }) : null
  }

  // One panel per tab, so every tab's aria-controls resolves.
  const paneKeys: SubTab[] = tabs.map((tb) => tb.key)
  const panes = paneKeys.map((key) => h('div', {
    key, id: `${tabsId}-${key}-panel`, role: 'tabpanel',
    'aria-labelledby': `${tabsId}-${key}`,
    style: paneOwner(key) ? { display: 'contents' } : { display: 'none' },
  }, paneContent(key)))

  // git-not-installed inside a repo: stack a notice above the browser.
  const body = gitMissingInRepo
    ? h('div', { className: 'gp-files-wrap' }, [
      gitNoticeClosed
        ? null
        : h(NoticeBar, { key: 'notice', text: t('files.gitNotInstalled'), closeLabel: t('common.close'), onClose: () => setGitNoticeClosed(true) }),
      ...panes,
    ])
    : h('div', { style: { display: 'contents' } }, panes)

  // `data-conversation-composer-overlay` opts the view into the shell's
  // full-height layout: the view area is fixed to the visible height with its
  // own overflow, and the composer/input bar floats over the bottom. Without
  // it the view grows with content and the whole conversation scrolls. The
  // sidebar has no composer under it, so it opts out.
  const overlay = host === 'conversation' ? { 'data-conversation-composer-overlay': '' } : {}
  return h('div', { className: 'gp-panel', ref: setRootEl, ...overlay, 'data-gp-host': host, 'data-font-delta': fontDelta, 'data-layout': mode }, [
    // data-tab-count feeds the compact indicator width (layout.ts): the
    // Repositories tab is conditional, and the platform's sliding pill needs the
    // same divisor the compact override restates.
    h('div', { key: 'tabs', className: 'gp-tabbar', 'data-tab-count': tabs.length }, [
      h(SegmentedTabs, {
        key: 'switcher',
        // A lone tab (non-git directory → Files only) has nothing to switch
        // between, so it must not stretch across the compact bar.
        className: `gp-tabbar__tabs${tabs.length === 1 ? ' gp-tabbar__tabs--single' : ''}`,
        label: t('panel.tabs'),
        items: tabItems,
        value: selectedTab,
        // The primitive hands back a plain string; accept only one of our tabs.
        onChange: (next: string) => {
          const picked = tabs.find((tb) => tb.key === next)
          if (picked !== undefined && hasSession(sessionId)) setSelection({ sessionId, tab: picked.key })
        },
      }),
      // Trailing cluster (font stepper + version bar). `display:contents` in the
      // wide layout keeps it transparent to the tab-bar flex (identical to the
      // flat layout). Compact drops both: the font step lives on the plugin
      // config page, and the version cluster would cost a second tab-bar row.
      // The stepper also requires the settings form (configForms) to write
      // back; without it the control would silently no-op.
      h('div', { key: 'trailing', className: 'gp-tabbar__trailing' }, [
        compact || stackedTight || !fontWritable
          ? null
          : h('div', { key: 'font', className: 'gp-font', role: 'group', 'aria-label': t('panel.fontSize') }, [
            h('button', { key: 'dec', type: 'button', className: 'gp-font__decrease', 'aria-pressed': fontDelta === -1, onClick: () => adjustFont(-1), 'aria-label': t('panel.fontDecrease') }, 'A−'),
            h('button', { key: 'reset', type: 'button', className: 'gp-font__reset', 'aria-pressed': fontDelta === 0, onClick: () => adjustFont(0), 'aria-label': t('panel.fontReset') }, 'A'),
            h('button', { key: 'inc', type: 'button', className: 'gp-font__increase', 'aria-pressed': fontDelta === 1, onClick: () => adjustFont(1), 'aria-label': t('panel.fontIncrease') }, 'A+'),
          ]),
        // The version cluster needs the wide bar's horizontal room, so every
        // narrow mode drops it. Compact has no spare row at all; stacked spends
        // its row on the tabs plus the font stepper, and an icon-only pill there
        // reads as "refresh this panel" rather than "check for a new version".
        // The check therefore stays a wide-layout control.
        compact || stacked ? null : h(VersionBar, { key: 'ver', remote, t }),
      ]),
    ]),
    h('div', { key: 'body', className: 'gp-body' }, body),
  ])
}

interface VersionBarProps {
  readonly remote: GitPanelRemote
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}

type VerState =
  | { kind: 'idle'; info?: GitVersionInfo }
  | { kind: 'checking'; info?: GitVersionInfo }

/** Trailing tab-bar cluster: current version plus a user-triggered update
 * check. Wide layouts only — see the mount site for why narrow modes drop it. */
function VersionBar({ remote, t }: VersionBarProps): JSX.Element {
  const [state, setState] = useState<VerState>({ kind: 'idle' })
  // Snappy tooltip for the star link, dropped below it (it sits at the panel top).
  const { tipProps, tipNode } = useHoverTip({ placement: 'below', maxWidth: 300 })

  // Fetch the local version once (no network); the remote check is manual.
  useEffect(() => {
    let alive = true
    void remote.version({}).then((res) => {
      if (alive && 'current' in res) setState((prev) => ({ ...prev, info: res }))
    })
    return () => { alive = false }
  }, [remote])

  const check = async (): Promise<void> => {
    setState((prev) => ({ kind: 'checking', info: prev.info }))
    const res = await remote.version({ check: true })
    setState({ kind: 'idle', info: 'current' in res ? res : undefined })
  }

  const info = state.info
  const status = ((): JSX.Element | null => {
    if (state.kind === 'checking') return h('span', { className: 'gp-verbar__status' }, t('version.checking'))
    if (info === undefined || !info.checkedRemote) return null
    if (info.error !== undefined) {
      return h('span', { className: 'gp-verbar__status gp-verbar__status--err', title: info.error }, info.error === 'repository is not configured' ? t('version.noRepo') : t('version.error'))
    }
    if (info.updateAvailable && info.latest !== undefined) {
      return h('span', {}, [
        h('span', { key: 's', className: 'gp-verbar__status gp-verbar__status--new' }, t('version.updateAvailable', { latest: info.latest, current: info.current })),
        info.releaseUrl !== undefined ? h('a', { key: 'l', className: 'gp-verbar__link', href: info.releaseUrl, target: '_blank', rel: 'noreferrer', style: { marginLeft: 8 } }, t('version.viewRelease')) : null,
      ])
    }
    return h('span', { className: 'gp-verbar__status gp-verbar__status--ok' }, t('version.upToDate', { current: info.current }))
  })()

  return h('div', { className: 'gp-verbar' }, [
    info !== undefined ? h('span', { key: 'tag', className: 'gp-verbar__tag' }, `v${info.current}`) : null,
    status,
    h('button', {
      key: 'btn', type: 'button', className: 'gp-verbar__btn',
      disabled: state.kind === 'checking',
      onClick: () => void check(),
    }, [h('span', { key: 'i', className: 'gp-tab__icon' }, h(RefreshIcon, { size: 12 })), t('version.check')]),
    info?.repositoryUrl !== undefined ? h('a', {
      key: 'gh', className: 'gp-icon-btn gp-verbar__gh gp-verbar__gh--starred', href: info.repositoryUrl,
      target: '_blank', rel: 'noreferrer', 'aria-label': t('version.openRepo'), ...tipProps(t('version.openRepo')),
    }, h(StarIcon, { size: 15 })) : null,
    tipNode,
  ])
}
