/**
 * Shared fast hover tooltip. The native `title` tooltip has a browser-controlled
 * delay (~500ms+) that cannot be shortened, so controls that want a snappier hint
 * use this instead: a short-delay tooltip portaled to document.body (so an
 * `overflow:hidden` ancestor — e.g. the overview left column — cannot clip it).
 * Keep each control's `aria-label` as its accessibility name; the tooltip is
 * purely visual.
 *
 * `showTipNow` is the press-driven half: a control whose first press only arms a
 * second press (the two-step discard) raises its own confirm hint right away
 * instead of waiting for another hover, and that hint stays until the next press
 * anywhere else.
 *
 * In the compact (phone) layout the bubble is centred on its control — the row
 * icons sit at the panel's right edge, where a left-anchored bubble reads as
 * belonging to the wrong row — while the wide layout keeps the familiar left
 * anchor. Centring needs no measuring: the bubble shifts itself by half its own
 * width. Either way a control near a viewport edge would hang the bubble
 * outside, so the measured overflow is folded back into `left` once.
 */
import { createElement as h, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { JSX } from 'react'

const DEFAULT_DELAY_MS = 140
const DEFAULT_MAX_W = 260

interface TipState { text: string; left: number; top?: number; bottom?: number; center?: boolean; maxW: number }

export interface HoverTip {
  /** Spread onto a control to give it the tooltip on hover/focus. */
  readonly tipProps: (text: string) => Record<string, unknown>
  /** The portaled tooltip element (or null); render it once in the tree. */
  readonly tipNode: JSX.Element | null
  /** Dismiss immediately (e.g. right after a click triggers an action). */
  readonly hideTip: () => void
  /** Show `text` against `el` at once (no hover delay); the bubble is pinned
   * until `hideTip` or a press outside it. */
  readonly showTipNow: (el: HTMLElement, text: string) => void
}

export function useHoverTip(opts?: { placement?: 'above' | 'below'; delayMs?: number; maxWidth?: number }): HoverTip {
  const placement = opts?.placement ?? 'above'
  const delayMs = opts?.delayMs ?? DEFAULT_DELAY_MS
  const maxWidth = opts?.maxWidth ?? DEFAULT_MAX_W
  const [tip, setTip] = useState<TipState | null>(null)
  /** A press-driven hint outlives the pointer; a hover hint does not. */
  const [pinned, setPinned] = useState(false)
  /** Mirrors `pinned` for handlers that must not be rebuilt on every arm. */
  const pinnedRef = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const flagPinned = useCallback((next: boolean) => {
    pinnedRef.current = next
    setPinned(next)
  }, [])

  const hideTip = useCallback(() => {
    if (timer.current !== undefined) { clearTimeout(timer.current); timer.current = undefined }
    flagPinned(false)
    setTip(null)
  }, [flagPinned])

  const placeTip = useCallback((el: HTMLElement, text: string) => {
    const r = el.getBoundingClientRect()
    // Compact (phone) panels centre the bubble on the control; the wide layout
    // keeps the left anchor it has always had.
    const center = el.closest('.gp-panel[data-layout="compact"]') !== null
    const left = center ? r.left + r.width / 2 : r.left
    // A fixed box with only `left` shrinks to the room on its right (a phone
    // row icon used to yield a 36px-wide column). Pin the width to its natural
    // size first — `.gp-tip` also carries `width:max-content` — capped to the
    // viewport so the measured pass below can always fit it back inside.
    const maxW = Math.min(maxWidth, Math.max(80, window.innerWidth - 16))
    // Anchor below the control (near the top of the panel) or above it
    // (the left-column footer); the measured pass keeps it on screen.
    if (placement === 'below') setTip({ text, left, center, maxW, top: r.bottom + 6 })
    else setTip({ text, left, center, maxW, bottom: Math.max(8, window.innerHeight - r.top + 6) })
  }, [placement, maxWidth])

  const showTip = useCallback((el: HTMLElement, text: string) => {
    // A pinned press hint owns the bubble until the next press outside it;
    // hovering another control must not replace the confirmation.
    if (pinnedRef.current) return
    if (timer.current !== undefined) clearTimeout(timer.current)
    flagPinned(false)
    timer.current = setTimeout(() => placeTip(el, text), delayMs)
  }, [placeTip, delayMs, flagPinned])

  const showTipNow = useCallback((el: HTMLElement, text: string) => {
    if (timer.current !== undefined) { clearTimeout(timer.current); timer.current = undefined }
    flagPinned(true)
    placeTip(el, text)
  }, [placeTip, flagPinned])

  // A bubble on a control near an edge would hang outside the viewport; measure
  // it once it is in the DOM and clamp both axes to absolute values. The clamp
  // is idempotent: the second pass computes the same numbers and stops, whereas
  // an additive correction keeps pushing when the bubble cannot fit at all.
  const tipRef = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const el = tipRef.current
    if (el === null || tip === null) return
    const margin = 8
    const viewportW = window.innerWidth
    const viewportH = window.innerHeight
    const r = el.getBoundingClientRect()
    const minLeft = tip.center === true ? margin + r.width / 2 : margin
    const maxLeft = tip.center === true ? viewportW - margin - r.width / 2 : viewportW - margin - r.width
    const left = Math.min(Math.max(tip.left, minLeft), Math.max(minLeft, maxLeft))
    // For both anchors the bubble's near edge must stay margin-clear of the
    // viewport edge: `top` counts from the top, `bottom` from the bottom, and
    // the tallest box either way is viewport - 2*margin.
    const maxAnchor = Math.max(margin, viewportH - margin - r.height)
    const top = tip.top === undefined ? undefined : Math.min(Math.max(tip.top, margin), maxAnchor)
    const bottom = tip.bottom === undefined ? undefined : Math.min(Math.max(tip.bottom, margin), maxAnchor)
    if (left === tip.left && top === tip.top && bottom === tip.bottom) return
    setTip((prev) => {
      if (prev === null) return prev
      const next: TipState = { ...prev, left }
      if (top !== undefined) next.top = top
      if (bottom !== undefined) next.bottom = bottom
      return next
    })
  }, [tip])

  // The pinned hint follows the control it explains, not the pointer: a press
  // outside the bubble (or Escape) dismisses it, including the press that acts
  // on the control again, since that press is handled after this listener runs.
  useEffect(() => {
    if (!pinned) return undefined
    const onDown = (e: PointerEvent): void => {
      const target = e.target
      if (target instanceof Element && target.closest('.gp-tip') !== null) return
      hideTip()
    }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') hideTip() }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [pinned, hideTip])

  const tipProps = useCallback((text: string): Record<string, unknown> => ({
    onMouseEnter: (e: { currentTarget: HTMLElement }) => showTip(e.currentTarget, text),
    // A pinned confirmation outlives the pointer; it stays until the next press.
    onMouseLeave: () => { if (!pinnedRef.current) hideTip() },
    onFocus: (e: { currentTarget: HTMLElement }) => showTip(e.currentTarget, text),
    onBlur: () => { if (!pinnedRef.current) hideTip() },
  }), [showTip, hideTip])

  const style: Record<string, number> = { left: tip?.left ?? 0, maxWidth: tip?.maxW ?? maxWidth }
  if (tip?.top !== undefined) style.top = tip.top
  if (tip?.bottom !== undefined) style.bottom = tip.bottom
  const tipNode = tip !== null && typeof document !== 'undefined'
    ? createPortal(h('div', {
      ref: tipRef,
      className: `gp-tip gp-tip--sb${tip.center === true ? ' gp-tip--center' : ''}`,
      style,
    }, tip.text), document.body)
    : null

  return { tipProps, tipNode, hideTip, showTipNow }
}
