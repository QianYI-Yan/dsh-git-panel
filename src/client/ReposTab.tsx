/**
 * Repositories tab: the panes of the panel act on exactly one checkout, and
 * this page is where that checkout is picked. It mirrors the source-control
 * repository list of an editor — one row per repository, the checked one
 * marked and carrying its branch and pending-change count — so the list is a
 * place you read, not a dropdown you have to open to discover.
 */
import { createElement as h } from 'react'
import type { JSX } from 'react'
import { BranchIcon, RepoIcon } from './icons.js'
import type { RepoChoice } from './repo-list.js'
import { repoDetail, repoLabel } from './repo-list.js'
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
  const branch = snapshot === null ? null : snapshot.branch
  const changed = snapshot === null ? 0 : snapshot.staged + snapshot.modified + snapshot.untracked
  const rows = choices.map((choice) => {
    const active = choice.path === current
    const label = choice.kind === 'root' ? t('repo.root') : repoLabel(choice)
    const detail = repoDetail(choice)
    const itemClass = 'gp-repos__item' + (active ? ' gp-repos__item--active' : '')
    return h('li', { key: choice.path === '' ? '__root' : choice.path, className: 'gp-repos__row' },
      h('button', {
        type: 'button',
        className: itemClass,
        // The list is a chooser, not a set of links: aria-current names the
        // one the panes act on, and picking it again is a no-op.
        'aria-current': active ? 'true' : undefined,
        onClick: () => { if (!active) onChoose(choice.path) },
      }, [
        h('span', { key: 'icon', className: 'gp-repos__icon' }, h(RepoIcon, { size: 15 })),
        h('span', { key: 'text', className: 'gp-repos__text' }, [
          h('span', { key: 'name', className: 'gp-repos__name' }, label),
          detail === '' ? null : h('span', { key: 'path', className: 'gp-repos__path' }, detail),
        ]),
        // Branch and change count belong to the checked row: they come from the
        // one snapshot the panel keeps, and printing them on the other rows
        // would claim state nobody sampled. Without a snapshot (the cwd is not
        // a checkout, or its sample failed) there is no HEAD to report at all —
        // the detached marker would invent one.
        active && snapshot !== null && branch !== null
          ? h('span', { key: 'branch', className: 'gp-repos__branch', title: branch }, [h(BranchIcon, { key: 'i', size: 12 }), branch])
          : null,
        active && snapshot !== null && branch === null
          ? h('span', { key: 'detached', className: 'gp-repos__branch gp-repos__branch--detached' }, t('pill.detached'))
          : null,
        // A bare count carries no meaning read on its own: the badge is one
        // image-like unit whose label states what is being counted.
        active && changed > 0
          ? h('span', { key: 'count', className: 'gp-repos__count', role: 'img', 'aria-label': t('repos.changedCount', { n: changed }) }, String(changed))
          : null,
      ]))
  })
  // The page only exists when the scan found repositories (Panel drops it
  // otherwise), so the list is rendered unconditionally.
  return h('div', { className: 'gp-repos' }, [
    h('p', { key: 'hint', className: 'gp-repos__hint' }, t('repos.hint')),
    h('ul', { key: 'list', className: 'gp-repos__list', role: 'list', 'aria-label': t('tab.repos') }, rows),
  ])
}
