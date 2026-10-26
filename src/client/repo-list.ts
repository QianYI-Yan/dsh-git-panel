/**
 * The Repositories tab's list model.
 *
 * The entries are the repositories the workspace scan found, plus one
 * synthetic "workspace root" entry when the cwd is not itself a checkout —
 * without it a pick would strand the reader inside one subdirectory with no
 * way back. Kept pure so that fallback, and the label rule that avoids
 * "site (site)", are unit-tested instead of living in render code.
 */
import type { GitRepoEntry } from './types.js'

export interface RepoChoice {
  /** Request tag for the host: '' is the session cwd itself. */
  readonly path: string
  /** Repository basename; null on the synthetic workspace-root entry. */
  readonly name: string | null
  /** Absolute repository root; '' on the synthetic entry. */
  readonly root: string
  readonly kind: 'workspace' | 'nested' | 'root'
}

/** The synthetic entry that stands for a cwd with no checkout of its own. */
const ROOT_CHOICE: RepoChoice = { path: '', name: null, root: '', kind: 'root' }

/**
 * Tab entries. An empty list means "no repository to pick from" (host that does
 * not answer repo-list yet, or a scan still in flight) and yields no tab at
 * all — the panel must keep its three panes in that case rather than open on a
 * page with a single unusable row. When the scan only found nested checkouts,
 * the cwd owns none of them, so the synthetic root entry leads as the way back.
 */
export function repoChoices(repos: readonly GitRepoEntry[]): readonly RepoChoice[] {
  if (repos.length === 0) return []
  const hasWorkspaceEntry = repos.some((entry) => entry.kind === 'workspace')
  const scanned: readonly RepoChoice[] = repos.map((entry) => ({
    path: entry.path,
    name: entry.name,
    root: entry.root,
    kind: entry.kind,
  }))
  return hasWorkspaceEntry ? scanned : [ROOT_CHOICE, ...scanned]
}

/**
 * Primary label of an entry. The relative path disambiguates two checkouts
 * sharing a basename, but repeating it when the basename already is the whole
 * path only adds noise. The synthetic entry returns '' — the caller supplies
 * the localized workspace-root name.
 */
export function repoLabel(choice: RepoChoice): string {
  if (choice.kind === 'root' || choice.name === null) return ''
  // The cwd's own checkout carries an empty path — the repository is the
  // workspace, so there is nothing to disambiguate.
  if (choice.path === '' || choice.name === choice.path) return choice.name
  return `${choice.name} (${choice.path})`
}

/**
 * Secondary line under the name: the checkout path. Empty for the root entry,
 * and empty when the basename already is the whole path — the label shows it
 * once, so a second line repeating it would only add noise.
 */
export function repoDetail(choice: RepoChoice): string {
  if (choice.kind === 'root') return ''
  return choice.name === choice.path ? '' : choice.path
}
