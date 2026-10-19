/**
 * Panel layout mode: observe the panel's own width and report whether it should
 * switch to the compact (single-column, drill-in) layout used on phones and
 * narrow splits. Width-driven via ResizeObserver (the GitPill.useCompactMarker
 * pattern), so the panel expands back to the three-column layout as soon as it
 * widens — a phone turned landscape, or a sidebar closing, recovers the full UI.
 *
 * The breakpoint is a container width, not the viewport, so a right sidebar that
 * squeezes the panel benefits too, and an iPad in portrait (768) keeps the wide
 * layout. 620 matches GitPill's COMPACT_WIDTH value (the two observe different
 * elements, so only the threshold — not the exact boundary pixel — is shared).
 *
 * Uses useLayoutEffect so the first measurement commits before the first paint:
 * a phone mounting at 390px never flashes the three-column layout for a frame.
 * If ResizeObserver is unavailable the panel stays wide (single-column drill-in
 * is lost, but nothing breaks) — all modern engines ship it.
 *
 * `useMobileViewport` is the other half of the phone story: a squeezed desktop
 * panel is compact too, but it is not a phone, and features that trade a
 * control away for scarce height (the commit editor's fold) key off this
 * instead of the container width.
 */
import { useLayoutEffect, useState } from 'react'

/** Panel width (px) at or below which the compact single-column layout kicks in. */
export const COMPACT_BP = 620

/** True once the observed element is measured and at or below COMPACT_BP wide. */
export function usePanelLayout(el: HTMLElement | null): boolean {
  const [compact, setCompact] = useState(false)
  useLayoutEffect(() => {
    if (el === null || typeof ResizeObserver === 'undefined') return
    const measure = (): void => setCompact(el.clientWidth > 0 && el.clientWidth <= COMPACT_BP)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return compact
}

/**
 * True while the window viewport itself is phone-narrow (at or below
 * COMPACT_BP). Container width cannot tell a phone from a desktop panel
 * squeezed by a sidebar — both measure narrow — so height-saving layouts ask
 * this question instead. Tracks live resizes (a rotated phone, a split view)
 * through the media-query change event.
 */
export function useMobileViewport(): boolean {
  const [mobile, setMobile] = useState(false)
  useLayoutEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(`(max-width: ${COMPACT_BP}px)`)
    const update = (): void => setMobile(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return mobile
}
