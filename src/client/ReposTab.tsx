/**
 * Repositories tab: the panes of the panel act on exactly one checkout, and
 * this page is where that checkout is picked. It mirrors the source-control
 * repository list of an editor — one card per checkout, the checked one marked
 * and carrying its branch and pending-change count — so the list is a place you
 * read, not a dropdown you have to open to discover. When the workspace offers
 * two families (its own worktrees and unrelated repositories), the cards split
 * into one section each; a single family stays one flat list.
 */
import { createElement as h } from 'react'
import type { JSX } from 'react'
import { BranchIcon, RepoIcon, WorktreeIcon } from './icons.js'
import type { RepoChoice, RepoGroup } from './repo-list.js'
import { repoDetail, repoDisabledKey, repoGroups, repoLabel } from './repo-list.js'
import type { GitSnapshot } from './types.js'
import type { GitKey } from './locales.js'

interface ReposTabProps {
  readonly choices: readonly RepoChoice[]
  /** Request tag of the checkout the panes currently act on ('' = cwd). */
  readonly current: string
  /** Snapshot of `current` only: other rows have no cheap state of their own. */
  readonly snapshot: GitSnapshot | null
  readonly onChoose: (path: string) => void
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}

export function ReposTab({ choices, current, snapshot, onChoose, t }: ReposTabProps): JSX.Element {
  const branch = snapshot === null ? undefined : snapshot.branch
  const changed = snapshot === null ? 0 : snapshot.staged + snapshot.modified + snapshot.untracked
  const groups = repoGroups(choices)
  const grouped = groups.length > 1
  const groupTitle = (group: RepoGroup): string => (group.key === 'own' ? t('repos.group.own') : t('repos.group.foreign'))

  const row = (choice: RepoChoice): JSX.Element => {
    const active = choice.path === current
    const label = repoLabel(choice)
    const detail = repoDetail(choice)
    const disabledKey = repoDisabledKey(choice)
    const isOwn = choice.kind === 'workspace' || choice.kind === 'worktree'
    // Same rule as the overview list: the checked card reports its snapshot;
    // any other card may only repeat what the list carries for it (a worktree's
    // branch is reported by git, a scanned repository is not sampled at all).
    const knownBranch = active ? (snapshot !== null ? branch : choice.branch) : isOwn ? choice.branch : undefined
    const tags: string[] = []
    if (choice.role === 'main') tags.push(t('repos.mainTag'))
    if (choice.locked === true) tags.push(t('repos.lockedTag'))
    const itemClass = 'gp-repos__item'
      + (active ? ' gp-repos__item--active' : '')
      + (disabledKey !== null ? ' gp-repos__item--disabled' : '')
    const icon = choice.role === 'linked' ? h(WorktreeIcon, { size: 15 }) : h(RepoIcon, { size: 15 })
    return h('li', { key: choice.path === '' ? '__root' : choice.path, className: 'gp-repos__row' },
      h('button', {
        type: 'button',
        className: itemClass,
        title: disabledKey !== null ? t(disabledKey) : choice.root === '' ? label : choice.root,
        // The list is a chooser, not a set of links: aria-current names the
        // one the panes act on, and picking it again is a no-op.
        'aria-current': active ? 'true' : undefined,
        disabled: disabledKey !== null,
        onClick: () => { if (!active) onChoose(choice.path) },
      }, [
        h('span', { key: 'icon', className: 'gp-repos__icon' }, icon),
        h('span', { key: 'text', className: 'gp-repos__text' }, [
          h('span', { key: 'name', className: 'gp-repos__name' }, label),
          tags.length > 0 || (disabledKey !== null && detail === '')
            ? h('span', { key: 'tags', className: 'gp-repos__tags' }, [
              ...tags.map((tag) => h('span', { key: tag, className: 'gp-repos__tag' }, tag)),
            ])
            : null,
          disabledKey !== null
            ? h('span', { key: 'why', className: 'gp-repos__path' }, t(disabledKey))
            : detail === '' ? null : h('span', { key: 'path', className: 'gp-repos__path' }, detail),
        ]),
        // Branch and change count belong to the checked card: they come from
        // the one snapshot the panel keeps — except a worktree's branch, which
        // the repository list itself reports (and a detached HEAD is a report
        // of null, not an absence).
        knownBranch !== undefined && knownBranch !== null
          ? h('span', { key: 'branch', className: 'gp-repos__branch', title: knownBranch }, [h(BranchIcon, { key: 'i', size: 12 }), knownBranch])
          : null,
        knownBranch === null
          ? h('span', { key: 'detached', className: 'gp-repos__branch gp-repos__branch--detached' }, t('pill.detached'))
          : null,
        // A bare count carries no meaning read on its own: the badge is one
        // image-like unit whose label states what is being counted.
        active && changed > 0
          ? h('span', { key: 'count', className: 'gp-repos__count', role: 'img', 'aria-label': t('repos.changedCount', { n: changed }) }, String(changed))
          : null,
      ]))
  }

  const section = (group: RepoGroup): JSX.Element => {
    const title = groupTitle(group)
    const list = h('ul', {
      key: 'list',
      className: 'gp-repos__list',
      role: 'list',
      'aria-label': grouped ? title : t('tab.repos'),
    }, group.items.map(row))
    if (!grouped) return list
    return h('div', { key: group.key, className: 'gp-repos__group', role: 'group', 'aria-label': title }, [
      h('div', { key: 'hd', className: 'gp-repos__grouphd' }, [
        h('span', { key: 'title', className: 'gp-repos__grouptitle' }, title),
        h('span', {
          key: 'count',
          className: 'gp-repos__groupcount',
          role: 'img',
          'aria-label': t('repos.countAria', { n: group.selectable, m: group.items.length }),
        }, group.selectable === group.items.length ? String(group.items.length) : `${group.selectable}/${group.items.length}`),
      ]),
      list,
    ])
  }

  // The page only exists when the scan found repositories (Panel drops it
  // otherwise), so the list is rendered unconditionally.
  const body: JSX.Element[] = grouped ? groups.map((group) => section(group)) : [section(groups[0])]
  return h('div', { className: 'gp-repos' }, [
    h('p', { key: 'hint', className: 'gp-repos__hint' }, t('repos.hint')),
    ...body,
  ])
}
