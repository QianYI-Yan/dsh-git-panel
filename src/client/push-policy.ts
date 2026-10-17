import type { GitSnapshot } from './types.js'

/** Offer only ordinary pushes from a branch strictly ahead of its upstream. */
export function canPush(snapshot: GitSnapshot): boolean {
  return snapshot.hasUpstream === true && snapshot.ahead > 0 && snapshot.behind === 0
}
