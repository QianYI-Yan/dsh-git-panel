# ADR-0006：信任边界单点校验与 `--end-of-options`

- 状态：Accepted（2026-10-18，迁移自现有实现）
- 相关：`src/host/validate.ts`、`src/host/actions.ts`、`src/host/queries.ts`

## Context

argv 传递解决了 shell 注入，但没有解决**参数位置注入**：一个以 `-` 开头的「分支名」会被 git 当成选项。git 里存在真实的写文件向量（例如 `--output=<file>`），所以「用户输入落在 argv 的选项位置」本身就是漏洞，不需要经过 shell。

防御有两条路：一是每个子命令都加 `--end-of-options` 把后续参数钉死为操作数；二是对所有进入 argv 的值做白名单校验。实际情况是两条都不完整——`git checkout` 与 `git reset` **不认** `--end-of-options`（较旧的 git 会直接报错，而不是把它当分隔符），历史上真出现过「切换分支全部误报目标不存在」的故障。

## Decision

- 经 RPC 到来的 path / ref / 分支名 / 标签名 / remote 名是**唯一不可信的 argv 素材**，必须先过 `src/host/validate.ts`：`isSafePath`（相对路径、规范化后不出工作树）、`isSafeRev`（非空、不以 `-` 开头、无空白/控制字符、无 glob 与 rev 元字符、不含 `..` 与 `@{`）、`isSafeBranchName`（在 rev 规则上再加「不以 `/` 开头」）、`isSafeRemoteName`（字符集白名单 + 长度上限）。
- 子命令支持 `--end-of-options` 时**再用它殿后**（belt-and-suspenders）；`checkout` / `reset` 不支持，就只靠校验兜底——这两处因此是校验最关键的调用点。
- 校验是**单点**的：host 的 action 规划与 query 分发在构造 argv 之前统一过校验，不存在「某个分支忘了校验」的旁路。贮藏 index 另在 `actions.ts` 校验为非负整数。
- 校验失败返回 `invalid-path` / `invalid-name` / `invalid-index` 等类型化错误码，不抛异常穿透 RPC。

## Consequences

- 校验逻辑集中在一个 45 行的模块里，可以整体测试（覆盖率 100%），新增命令时只需确认它是否经过校验。
- `checkout` / `reset` 的安全性完全依赖 `isSafeBranchName` / `isSafeRev` 的正确性——这是已知的单点风险，任何放宽这两条规则（例如允许以 `-` 开头的分支名）都必须先确认 git 的行为。
- 白名单偏严：带空格或 `..` 的合法 ref 会被拒绝。这是刻意取舍——面板面向常见分支命名，宁可再生硬拒绝也不放宽 argv 位置。
