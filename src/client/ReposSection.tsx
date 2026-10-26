/**
 * Repository list of the Git overview.
 *
 * The panes of the panel act on exactly one checkout; this list lives in the
 * overview's left column, above the branch tree, so picking one keeps the
 * branches, the commit list and the list itself on screen together. Rows are
 * compact — the column is narrow — one line for the name and one for the state
 * of the checkout the panes are reading.
 */
import { createElement as h } from 'react'
import type { JSX } from 'react'
import { BranchIcon, RepoIcon } from './icons.js'
import type { RepoChoice } from './repo-list.js'
import { repoDetail, repoLabel } from './repo-list.js'
import type { GitSnapshot } from './types.js'
import type { GitKey } from './locales.js'

interface ReposSectionProps {
  readonly choices: readonly RepoChoice[]
  /** Request tag of the checkout the panes currently act on ('' = cwd). */
  readonly current: string
  /** Snapshot of `current` only: the other rows have no cheap state of their own. */
  readonly snapshot: GitSnapshot | null
  readonly onChoose: (path: string) => void
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
  /** `list` is the narrow column of the overview; `strip` is the horizontal
   * band above the file tree, where wrapping beats a tall narrow column. */
  readonly variant?: 'list' | 'strip'
  /** Render even for a single choice: a non-checkout cwd needs the row to reach
   * the one repository nested below it. */
  readonly always?: boolean
}

export function ReposSection({ choices, current, snapshot, onChoose, t, variant = 'list', always = false }: ReposSectionProps): JSX.Element | null {
  // One checkout is not a choice: a single row would only repeat the pill, and
  // the branch tree below already names it.
  if (!always && choices.length < 2) return null
  const branch = snapshot === null ? null : snapshot.branch
  const changed = snapshot === null ? 0 : snapshot.staged + snapshot.modified + snapshot.untracked
  const rows = choices.map((choice) => {
    const active = choice.path === current
    const label = choice.kind === 'root' ? t('repo.root') : repoLabel(choice)
    const detail = repoDetail(choice)
    const itemClass = 'gp-repolist__item' + (active ? ' gp-repolist__item--active' : '')
    return h('li', { key: choice.path === '' ? '__root' : choice.path, className: 'gp-repolist__row' },
      h('button', {
        type: 'button',
        className: itemClass,
        title: choice.root === '' ? label : choice.root,
        // The list is a chooser, not a set of links: aria-current names the one
        // the panes act on, and picking it again is a no-op.
        'aria-current': active ? 'true' : undefined,
        onClick: () => { if (!active) onChoose(choice.path) },
      }, [
        h('span', { key: 'icon', className: 'gp-repolist__icon' }, h(RepoIcon, { size: 14 })),
        h('span', { key: 'text', className: 'gp-repolist__text' }, [
          h('span', { key: 'name', className: 'gp-repolist__name' }, label),
          h('span', { key: 'meta', className: 'gp-repolist__meta' }, [
            // Branch and change count belong to the checked row: they come from
            // the one snapshot the panel keeps, and printing them on the other
            // rows would claim state nobody sampled. Without a snapshot there is
            // no HEAD to report, and the detached marker would invent one.
            active && snapshot !== null && branch !== null
              ? h('span', { key: 'branch', className: 'gp-repolist__branch' }, [h(BranchIcon, { key: 'i', size: 11 }), branch])
              : null,
            active && snapshot !== null && branch === null
              ? h('span', { key: 'branch', className: 'gp-repolist__branch gp-repolist__branch--detached' }, t('pill.detached'))
              : null,
            detail === '' ? null : h('span', { key: 'path', className: 'gp-repolist__path' }, detail),
          ]),
        ]),
        // A bare count carries no meaning read on its own: the badge is one
        // image-like unit whose label states what is being counted.
        active && changed > 0
          ? h('span', { key: 'count', className: 'gp-repolist__count', role: 'img', 'aria-label': t('repos.changedCount', { n: changed }) }, String(changed))
          : null,
      ]))
  })
  return h('div', { className: variant === 'strip' ? 'gp-repolist gp-repolist--strip' : 'gp-repolist' }, [
    h('div', { key: 'head', className: 'gp-repolist__head' }, [
      h('span', { key: 'label', className: 'gp-repolist__label' }, t('tab.repos')),
      h('span', { key: 'n', className: 'gp-repolist__badge' }, String(choices.length)),
    ]),
    h('ul', { key: 'list', className: 'gp-repolist__list', role: 'list', 'aria-label': t('tab.repos') }, rows),
  ])
}
