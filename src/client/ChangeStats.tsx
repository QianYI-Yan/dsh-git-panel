/** Changes-page statistics bar: file count / line changes / last-change time. */
import { createElement as h } from 'react'
import type { JSX } from 'react'
import type { WorktreeStats } from './types.js'
import type { GitKey } from './locales.js'
import { absoluteTime, timeAgo } from './time.js'
import { useHoverTip } from './tip.js'

interface StatsProps {
  /** Stats ride the snapshot (single git source); no separate query. */
  readonly stats: WorktreeStats
  /** Narrow panel: the counts lead one line instead of a wrapping bar. */
  readonly compact?: boolean
  /**
   * Render the change / commit timestamps. The caller drops them only when the
   * panel is cramped (narrow *and* short) and the row is genuine cost; a
   * squeezed-but-tall panel keeps them on their own line.
   */
  readonly showTimes?: boolean
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}

export function ChangeStats({ stats, compact = false, showTimes = true, t }: StatsProps): JSX.Element {
  const now = Date.now()
  // Snappy shared tip for the partial-stats marker (a native `title` waits
  // half a second and feels unresponsive on a frequently rescanned bar).
  const { tipProps, tipNode } = useHoverTip({ placement: 'below', maxWidth: 280 })

  const items: JSX.Element[] = [
    h('span', { key: 'files', className: 'gp-stats__item gp-stats__chip' }, t('stats.files', { n: stats.fileCount })),
    h('span', { key: 'lines', className: 'gp-stats__item gp-stats__chip' }, [
      h('span', { key: 'a', className: 'gp-stats__add' }, `+${stats.insertions}`),
      ' ',
      h('span', { key: 'd', className: 'gp-stats__del' }, `\u2212${stats.deletions}`),
    ]),
  ]
  // Each count leads with the git mark the file rows use (S / M / U) and takes
  // that mark's colour, so the bar reads at a glance instead of parsing labels.
  if (stats.staged > 0) items.push(h('span', { key: 'st', className: 'gp-stats__item gp-stats__chip gp-stats__item--staged' }, [
    h('span', { key: 'm', className: 'gp-status-badge gp-stats__badge gp-status--staged', 'aria-hidden': 'true' }, 'S'),
    t('stats.staged', { n: stats.staged }),
  ]))
  if (stats.modified > 0) items.push(h('span', { key: 'mo', className: 'gp-stats__item gp-stats__chip gp-stats__item--modified' }, [
    h('span', { key: 'm', className: 'gp-status-badge gp-stats__badge gp-status--modified', 'aria-hidden': 'true' }, 'M'),
    t('stats.modified', { n: stats.modified }),
  ]))
  if (stats.untracked > 0) items.push(h('span', { key: 'un', className: 'gp-stats__item gp-stats__chip gp-stats__item--untracked' }, [
    h('span', { key: 'm', className: 'gp-status-badge gp-stats__badge gp-status--added', 'aria-hidden': 'true' }, 'U'),
    t('stats.untracked', { n: stats.untracked }),
  ]))
  // On a very large change set the host skips the per-file line/mtime fan-outs
  // (issue #16); flag that the "+/-" count omits untracked lines so it isn't
  // read as exact. The hint rides the shared fast tip, not a native title.
  if (stats.partial) items.push(h('span', {
    key: 'partial', className: 'gp-stats__item gp-stats__chip gp-stats__chip--quiet gp-stats__partial',
    'aria-label': t('stats.partial'),
    ...tipProps(t('stats.partialHint')),
  }, t('stats.partial')))

  // The two timestamps live in one wrap-together group so they always share a
  // line instead of the last-commit time dropping to its own row. Each is a chip
  // holding its own label and a nested time pill, in its own status colour, so
  // the two rows of the bar never read as one run-on sentence. Absolute times
  // are secondary detail on hover — the native title delay is fine here.
  const timeChip = (key: string, cls: string, at: number | string, label: GitKey): JSX.Element =>
    h('span', { key, className: `gp-stats__item gp-stats__chip ${cls}`, title: absoluteTime(at) }, [
      h('span', { key: 'k', className: 'gp-stats__chip-label' }, t(label)),
      h('span', { key: 'v', className: 'gp-stats__chip-value' }, timeAgo(at, now, t)),
    ])
  const times: JSX.Element[] = []
  if (stats.lastChangeAt !== null) times.push(timeChip('lc', 'gp-stats__chip--change', stats.lastChangeAt, 'stats.lastChangeLabel'))
  if (stats.headCommittedAt !== null) times.push(timeChip('hc', 'gp-stats__chip--commit', stats.headCommittedAt, 'stats.lastCommitLabel'))
  const timesBlock = times.length > 0
    ? h('span', { key: 'times', className: 'gp-stats__times' }, times)
    : null

  // Wide: everything rides one wrapping bar. Narrow: the counts lead a clipped
  // line; the timestamps join on a second line unless the caller dropped them
  // (a cramped panel cannot spare the row).
  if (!compact) {
    return h('div', { className: 'gp-stats' }, [
      ...(timesBlock === null ? items : [...items, timesBlock]),
      tipNode,
    ])
  }
  const timed = showTimes && timesBlock !== null
  return h('div', { className: `gp-stats gp-stats--compact${timed ? ' gp-stats--timed' : ''}` }, [
    h('div', { key: 'main', className: 'gp-stats__main' }, items),
    timed ? timesBlock : null,
    tipNode,
  ])
}
