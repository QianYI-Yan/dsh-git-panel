/**
 * Panel fit policy: the two container breakpoints and how they combine.
 *
 * Pure on purpose — no React, no platform — so the rule that decides whether
 * the panel may spend vertical space is unit-testable on its own, and the hook
 * that measures the box stays a thin adapter.
 */

/** Panel width (px) at or below which the compact single-column layout kicks in. */
export const COMPACT_BP = 620

/**
 * Panel height (px) at or below which vertical room is scarce. Only meaningful
 * together with `compact`: the panel must be narrow *and* short before content
 * is traded for room. 520 catches small phones and short windows while leaving
 * a typical portrait phone panel (~690) and a laptop column (~660) their full
 * editor and timestamps.
 */
export const SHORT_BP = 520

export interface PanelLayout {
  /** The panel is at or below COMPACT_BP wide. */
  readonly compact: boolean
  /** The panel is at or below SHORT_BP tall. */
  readonly short: boolean
}

/**
 * Both axes are scarce at once. This is the single gate for features that trade
 * a control or a row for room (the commit editor's fold, the change
 * timestamps): a wide screen whose column a sidebar narrowed has the height to
 * spare and keeps them, and so does a large phone.
 */
export function isCramped(layout: PanelLayout): boolean {
  return layout.compact && layout.short
}
