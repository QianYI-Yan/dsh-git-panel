import type { SnapshotDeps, GitPanelConfig } from './core.js';
import type { GitQueryRequest, GitQueryResponse } from './types.js';
export declare function runQuery(deps: SnapshotDeps, config: GitPanelConfig, request: GitQueryRequest): Promise<GitQueryResponse>;
