/**
 * Batch-discard target resolution. Change-list selection keys carry the side
 * they were picked on (`path:w` working tree, `path:s` index), while `discard`
 * only ever touches the working tree (`git restore --`, untracked files are
 * deleted). So a batch discard acts on the `:w` picks, and index-side picks are
 * reported separately instead of being silently swallowed by the count.
 */
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

export function pickDiscardTargets(keys: Iterable<string>): DiscardTargets {
  const worktree = new Set<string>()
  const staged = new Set<string>()
  for (const key of keys) {
    if (key.endsWith(':w')) worktree.add(key.slice(0, -2))
    else if (key.endsWith(':s')) staged.add(key.slice(0, -2))
  }
  return {
    paths: [...worktree].sort(),
    stagedOnly: [...staged].filter((p) => !worktree.has(p)).sort(),
  }
}
