/**
 * Per-session repository selection.
 *
 * The panel can follow a nested repository below the workspace instead of the
 * repository the workspace lives in. A selection is that repository's path
 * relative to the session cwd — '' means "the repository the cwd belongs to",
 * which is the historical behavior. State is module-level so the pill, all
 * three tabs and every RPC share one choice per session.
 */
import type { GitPanelRemote } from './rpc.js'

const selections = new Map<string, string>()
/** Sessions whose explicit pick was `''` (the cwd's own repository): `''`
 * resets the selection map, so intent has to live outside it or "never
 * picked" and "picked `''` on purpose" would be the same state. */
const rootPicks = new Set<string>()

/** The repository this session follows ('' = the cwd's own repository). */
export function selectedRepo(sessionId: string): string {
  return selections.get(sessionId) ?? ''
}

/** Whether this session ever chose a checkout — including a deliberate return
 * to the workspace root. A repair (dropRepo) is not a choice. */
export function hasRepoPick(sessionId: string): boolean {
  return selections.has(sessionId) || rootPicks.has(sessionId)
}

/** Point a session at another repository; '' records a deliberate pick of the
 * workspace root (the reset of the selection itself, but not of the intent). */
export function selectRepo(sessionId: string, repo: string): void {
  if (repo === '') {
    selections.delete(sessionId)
    rootPicks.add(sessionId)
  } else {
    rootPicks.delete(sessionId)
    selections.set(sessionId, repo)
  }
}

/** Forget any pick without recording intent: the repair path (a pick the host
 * can no longer resolve) must not read as "the user chose the root". */
export function clearRepoPick(sessionId: string): void {
  selections.delete(sessionId)
  rootPicks.delete(sessionId)
}

/**
 * A remote face that tags every repository-scoped request with `repo`. The tabs
 * and their hooks stay unaware of the selection: they keep calling
 * `remote.query({ sessionId, query })` and this wrapper fills the field in.
 */
export function withRepo(remote: GitPanelRemote, repo: string): GitPanelRemote {
  if (repo === '') return remote
  const tag = <T extends { readonly sessionId: string }>(request: T): T => ({ ...request, repo }) as T
  return {
    snapshot: (request, signal) => remote.snapshot(tag(request), signal),
    run: (request, signal) => remote.run(tag(request), signal),
    query: (request, signal) => remote.query(tag(request), signal),
    suggest: (request, signal) => remote.suggest(tag(request), signal),
    // Version lookup is host-scoped, never repository-scoped.
    version: (request, signal) => remote.version(request, signal),
    openFile: (request, signal) => remote.openFile(tag(request), signal),
  }
}
