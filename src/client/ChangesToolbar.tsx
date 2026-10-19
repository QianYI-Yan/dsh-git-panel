/** Compact, single-row repository actions for the changes list. */
import { createElement as h, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { GitKey } from './locales.js'
import type { GitSnapshot } from './types.js'
import { RefreshIcon, StageAllIcon, StashIcon, TrashIcon, UnstageAllIcon, UploadIcon } from './icons.js'
import { TipWrapper, useHoverTip } from './tip.js'
import { canPush } from './push-policy.js'

interface ChangesToolbarProps {
  readonly snapshot: GitSnapshot
  readonly busy: boolean
  readonly hasDiscardTargets: boolean
  readonly onStageAll: () => void
  readonly onUnstageAll: () => void
  readonly onDiscard: () => void
  readonly onStash: () => void
  readonly onPush: () => void
  readonly onRefresh: () => Promise<void>
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}

export function ChangesToolbar(props: ChangesToolbarProps): JSX.Element {
  const { snapshot, busy, t } = props
  const [refreshing, setRefreshing] = useState(false)
  const refreshFlight = useRef(false)
  const { tipProps, tipNode, hideTip } = useHoverTip({ placement: 'below' })
  useEffect(() => { hideTip() }, [snapshot, hideTip])
  const refresh = async (): Promise<void> => {
    if (refreshFlight.current) return
    refreshFlight.current = true
    setRefreshing(true)
    try { await props.onRefresh() }
    finally { refreshFlight.current = false; setRefreshing(false) }
  }
  const disabled = busy || refreshing
  // Tip handlers live on a non-disabled wrapper: a `disabled` button swallows
  // mouse events, so hover would never reach the button itself (issue #61).
  const button = (key: string, label: GitKey, icon: JSX.Element, unavailable: boolean, onClick: () => void, extraClass = ''): JSX.Element => h(TipWrapper, {
    key, tipProps: tipProps(t(label)),
  }, h('button', {
    type: 'button', className: `gp-icon-btn gp-changes__${key}${extraClass}`,
    'aria-label': t(label), disabled: disabled || unavailable,
    ...(key === 'refresh' ? { 'aria-busy': refreshing } : {}),
    onClick: () => { hideTip(); onClick() },
  }, h('span', { 'aria-hidden': true }, icon)))
  return h('div', { className: 'gp-toolbar gp-changes__toolbar', role: 'group', 'aria-label': t('changes.actions') }, [
    button('stage-all', 'changes.stageAll', h(StageAllIcon, { size: 16 }), snapshot.changes.length === 0, props.onStageAll),
    button('unstage-all', 'changes.unstageAll', h(UnstageAllIcon, { size: 16 }), snapshot.staged === 0, props.onUnstageAll),
    button('discard-picked', 'changes.discardPicked', h(TrashIcon, { size: 16 }), !props.hasDiscardTargets, props.onDiscard),
    button('stash', 'changes.stash', h(StashIcon, { size: 16 }), snapshot.staged === 0 && snapshot.modified === 0, props.onStash),
    button('push', 'status.pushTitle', h(UploadIcon, { size: 16 }), !canPush(snapshot), props.onPush),
    button('refresh', 'changes.refresh', h(RefreshIcon, { size: 16 }), false, () => void refresh(), refreshing ? ' gp-changes__refresh--busy' : ''),
    tipNode,
  ])
}
