# ADR-0009：快照单一来源与业务/刷新分离

- 状态：Accepted（2026-10-18，迁移自现有实现）
- 相关：`src/client/controller.ts`、`src/client/registry.ts`、`src/host/snapshot-fingerprint.ts`、`test/unit/steady-state.test.mjs`

## Context

同一份仓库状态有三个消费方：输入框标记（pill）、变更记录页、统计条。每个都想要最新状态，而刷新一份快照要跑一批 git 命令。

两种直觉做法都试过，都不行：

- **各自轮询**：三处各拉一份快照，git 进程数乘以三，且三处可能显示不同时刻的状态（同一分支在两处显示不同 ahead/behind）。
- **业务状态变了才刷新**：快照里带 `checkedAt` 时间戳，每次轮询都变；若把它当作变更信号，业务视图每 30 秒重渲染一次，而实际上什么都没变。

## Decision

- **快照单一来源**：每个 session 一个 `GitController`（`registry.ts` 按 session 复用，最后一份引用释放后 60s 回收）；pill、变更页、统计条共用它，禁止任何一方自行发起 snapshot。
- **业务与刷新分离**：`snapshot-fingerprint.ts` 计算 `stateFingerprint`——把快照键排序后取 SHA-256，**排除 `checkedAt`**。指纹相同只抑制**业务 view 通知**，不抑制查询 tick。
- **查询刷新键是结构化的**：子查询的刷新键是 `[root, tick, 本地失效]`；**不得**把业务 `checkedAt` 或 snapshot 对象引用当作 effect 触发器。
- **一次动作/采样只补一批查询**；`stateFingerprint` 不代表 refs / stash 未变——总览仍按 tick 刷新。
- **写操作回灌**：动工作区的操作经 `onAction` 把新快照交回 controller；不动工作区的标签操作走本地 `opBump` 触发刷新。

## Consequences

- git 进程数不随消费方数量增长；三处显示必然一致。
- 代价是这套「业务 vs 刷新」的区分很微妙：把 snapshot 或 `checkedAt` 加进 effect 依赖会立刻退化成重复请求，而它在功能上「看起来也对」。`test/unit/steady-state.test.mjs` 与 e2e 的 `sameFingerprintPolling` 断言锁住「指纹相同的轮询不产生业务重渲染」。
- `stateFingerprint` 相同**不**意味着 refs / stash 没变（它们不在指纹里），所以总览必须继续按 tick 刷新——这是一个容易误读的边界，写在 `AGENTS.md` 的「数据流铁律」里。
