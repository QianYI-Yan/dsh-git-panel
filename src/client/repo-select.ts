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

/** The repository this session follows ('' = the cwd's own repository). */
export function selectedRepo(sessionId: string): string {
  return selections.get(sessionId) ?? ''
}

/** Point a session at another repository; '' resets it to the default. */
export function selectRepo(sessionId: string, repo: string): void {
  if (repo === '') selections.delete(sessionId)
  else selections.set(sessionId, repo)
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
