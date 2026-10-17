/**
 * Focus lifecycle for a portaled modal dialog: move focus to the close control
 * on open, keep Tab cycling inside the dialog, close on Escape (capture phase,
 * so it wins over handlers on the page behind) and restore the opener on
 * unmount. Shared by the image lightbox and the file fullscreen reader so both
 * follow the same contract.
 *
 * `onClose` is read through a ref: callers pass inline arrows, and re-running
 * the effect on every render would re-focus the dialog and restore focus on
 * each cleanup.
 */
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

export function useDialogFocus(
  containerRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  initialFocusRef?: RefObject<HTMLElement | null>,
): void {
  const closeRef = useRef(onClose)
  useLayoutEffect(() => { closeRef.current = onClose })

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    initialFocusRef?.current?.focus()
    const focusables = (): HTMLElement[] => {
      const root = containerRef.current
      if (root === null) return []
      return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
        .filter((el) => !el.hasAttribute('disabled') && el.getClientRects().length > 0)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) return
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
      const idx = active === null ? -1 : items.indexOf(active)
      event.preventDefault()
      const delta = event.shiftKey ? -1 : 1
      const next = idx === -1
        ? (delta === -1 ? items.length - 1 : 0)
        : (idx + delta + items.length) % items.length
      items[next]?.focus()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      opener?.focus()
    }
  }, [containerRef, initialFocusRef])
}
