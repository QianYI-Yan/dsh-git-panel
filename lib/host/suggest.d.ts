import type { GitPanelConfig, SnapshotDeps } from './core.js';
import type { GitSuggestRequest, GitSuggestResult } from './types.js';
/** Generate a commit message for the session's uncommitted changes. */
export declare function runSuggest(deps: SnapshotDeps, config: GitPanelConfig, request: GitSuggestRequest): Promise<GitSuggestResult>;
