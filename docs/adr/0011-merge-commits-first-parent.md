# ADR-0011：合并提交按 first-parent 三处同源

- 状态：Accepted（2026-10-18，迁移自现有实现）
- 相关：`src/host/queries.ts`、`test/unit/host-integration.test.mjs`

## Context

提交详情页由三份数据拼成：文件列表、`+/-` 统计、单文件 diff。它们必须描述**同一个** diff，否则数字对不上。

git 在合并提交上的默认行为恰好会破坏这一点：

- `--name-status` 默认走 **combined diff**：只列出「与所有父提交都不同」的文件，补丁还可能整体为空；
- `--numstat` 默认走 **first-parent**。

于是同一个 merge 上，文件数来自一份 diff、增删行数来自另一份。用户看到的现象是：文件列表有几个文件，点开某一个只剩提交头、显示 `+0 −0`。这不是显示 bug，是两个不同问题被拼在了一起。

## Decision

- 提交详情的**文件列表、`+/-` 统计、单文件 diff 三处统一使用 `FIRST_PARENT_DIFF`**（`--diff-merges=first-parent`）。
- 与 image-diff 保持一致：图片对照读的是 `<commit>^1`，语义上也是 first-parent。
- 这条同源要求是**跨三处的一致性约束**，任何一处单独改回默认都会让数字重新对不上。

## Consequences

- 合并提交的详情与 `git show --first-parent` 的直觉一致，数字自洽。
- 代价：看不到 combined diff 的视角（「这个 merge 相对所有父提交带来了什么」）。对面板的用户场景（看这次合并改了什么）来说 first-parent 更常用。
- 回归保护很强：`test/unit/host-integration.test.mjs` 用三个夹具（hunk 分离的双父 merge、冲突解决 merge、普通 merge）断言；**去掉 `--diff-merges=first-parent` 即全部转红**。
