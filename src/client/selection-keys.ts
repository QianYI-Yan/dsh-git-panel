/**
 * Change-list selection keys. A key carries the side the row was picked on:
 * `path:w` (working tree) / `path:s` (index). A path that is both staged and
 * modified shows up as two rows, so selection / active / armed are keyed by
 * path+side and acting on one row does not light up the other.
 *
 * Every construction and every parse goes through this module: an inline
 * `path + (staged ? ':s' : ':w')` or `key.replace(/:[sw]$/, '')` elsewhere
 * would be a second authority for the same format.
 */
import type { GitChange } from './types.js'

/** The side a selection key was picked on. */
export type ChangeSide = 's' | 'w'

/** Selection key for a change row (`path:s` when staged, else `path:w`). */
export function changeKey(c: Pick<GitChange, 'path' | 'staged'>): string {
  return c.path + (c.staged ? ':s' : ':w')
}

/** Side carried by a key, or null when the key has no known side suffix. */
export function sideOf(key: string): ChangeSide | null {
  if (key.endsWith(':s')) return 's'
  if (key.endsWith(':w')) return 'w'
  return null
}

/** Bare path behind a key; only a trailing side suffix is dropped. */
export function pathOfKey(key: string): string {
  return key.replace(/:[sw]$/, '')
}

export interface DiscardTargets {
  /** Deduped working-tree paths `discard` will act on (sorted for a stable request). */
  readonly paths: readonly string[]
  /**
   * Paths picked on the index side only (`:s` with no `:w` pick of the same
   * path). A working-tree discard cannot touch them, so the dialog names their
   * count instead of quietly leaving them out of the total.
   */
  readonly stagedOnly: readonly string[]
}

/**
 * Batch-discard target resolution. `discard` only ever touches the working tree
 * (`git restore --`, untracked files are deleted), so a batch discard acts on
 * the `:w` picks and index-side picks are reported separately rather than being
 * silently swallowed by the count. Keys with no known side are ignored.
 */
export function pickDiscardTargets(keys: Iterable<string>): DiscardTargets {
  const worktree = new Set<string>()
  const staged = new Set<string>()
  for (const key of keys) {
    const side = sideOf(key)
    if (side === null) continue
    const path = pathOfKey(key)
    if (side === 'w') worktree.add(path)
    else staged.add(path)
  }
  return {
    paths: [...worktree].sort(),
    stagedOnly: [...staged].filter((p) => !worktree.has(p)).sort(),
  }
}
