# ADR-0007：写操作不越权：push / pull / publish / 检出

- 状态：Accepted（2026-10-18，迁移自现有实现）
- 相关：`src/client/push-policy.ts`、`src/host/actions.ts`、`src/client/overview-statusbar.tsx`

## Context

面板能对远程仓库动手，而这些操作**不可逆或难以回滚**：`push --force` 会覆盖别人的提交，`pull` 的默认合并会产生意料之外的 merge commit，直接检出远程引用会留下游离 HEAD 让用户以为「我的分支没了」。

这些是 git 本身提供的灵活性，不是 bug；问题在于 GUI 上的一次误点就能触发。用户预期面板是「安全的日常操作入口」，危险动作应该留在终端里。

## Decision

- **push 绝不 `--force`**，且只在当前分支**严格领先**（ahead > 0 且 behind = 0）时提供；分叉（ahead > 0 且 behind > 0）时 push 与 pull 都不提供，UI 不给「赌一把」的入口。
- **pull 只走 `--ff-only`**：本地与远程分叉时直接拒绝，绝不产生 merge commit 或 rebase。
- **绝不直接检出远程引用**：`branch-checkout` 带 `createFrom`（如 `origin/x`）时落为同名本地分支并设置跟踪（`git checkout -b x --track origin/x`），避免游离 HEAD。
- **publish 的 `HEAD`、pull-preview 的 `@{upstream}` 是固定字面量**，不接受来自 RPC 的拼接；remote 名来自 client 已持有的 primary remote，host 侧再校验一次。
- 这些策略在 client 与 host 两侧都有实现：`push-policy.ts` 的 `canPush` 决定按钮是否可用（被 4 处引用），host 侧不依赖 UI 的自律——请求不合规时照样拒绝。
- 破坏性本地操作（discard、reset、stash-drop、删除标签、带贮藏的分支切换）必须二次确认；硬重置还要列出将丢失的改动并额外勾选。

## Consequences

- 面板永远不会「吃掉」远程历史，也不需要用户理解 force-push 的语义。
- 代价：分叉状态下面板帮不上忙，用户必须去终端——这是刻意的，分叉意味着需要人来判断。
- 二次确认增加了日常操作的点击成本；「放弃更改」只作用于工作区侧，暂存侧的改动必须先取消暂存，避免一次点击同时丢两边。
- 任何「顺手放开一点」的改动（例如为了便利加上 force、或让 pull 允许合并）都违反本 ADR，需要新写一份 ADR 说明理由。
