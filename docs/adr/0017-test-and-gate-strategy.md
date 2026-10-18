# ADR-0017：测试与门禁策略

- 状态：Accepted（2026-10-18，迁移自现有实现）
- 相关：`package.json` 的 scripts、`test/unit/`、`test/e2e/all.mjs`、`.github/workflows/ci.yml`

## Context

这个插件有两半、跑在别人的进程里、还要对用户的仓库做写操作，所以「改动前能验证」比一般项目更重要。但测试基建本身有几个已知陷阱，都是踩过之后才定下规则的：

- **e2e 串行门禁**：早期用 `&&` 串联 runner，**第一个红的 runner 会吞掉后面所有 runner**——曾因此让 9 个 runner 长期不执行，而门禁是绿的。
- **`--test-force-exit`**：它在文件并行下会把仍在跑的文件整个拆掉，丢掉正在执行的用例及其后同文件全部用例，而报告是 `fail 0`、`skipped 0`。实测（容器内 node 22、默认并发）带该 flag 17 次里 8 次少跑（489→483/482/481）；去掉后 17 次全部正常，耗时同为 ~18s。
- **lock 漂移**：`package-lock.json` 曾停在 0.3.0 跨越七次发版，因为发版只改 manifest；CI 的 `npm ci` 会直接拒绝。
- **产物漂移**：`lib/` 入库后，改了 `src/` 忘了重建不会被运行时发现，只会静默发出过期入口。

## Decision

- **两层测试**：`test/unit/*.test.mjs`（`node --test`，纯算法 + host 端点 + 真实临时仓库的集成）与 `test/e2e/*.mjs`（隔离的 `file://` 无头浏览器，**绝不碰运行中的实例**）。
- **e2e 必须跑完全部 runner 再汇总失败**（`test/e2e/all.mjs`）；**不要改回 `&&` 串联**。
- **`test:unit` 刻意不传 `--test-force-exit`**；**不要加回来**。
- **一键门禁** `npm run check` = 类型检查 + 全部测试 + `git diff --exit-code -- lib/`（产物新鲜度）；CI 与它等价，跑 node 22/24 矩阵。
- **lock 同步**由 `test/unit/lock-sync.test.mjs` 守住；发版用 `npm version <v> --no-git-tag-version`（同时改 manifest 与 lock 两处）。
- **契约测试** `plugin-contract.test.mjs` 守安装身份三处一致与「无安装期脚本」（ADR-0003）。
- **架构护栏** `architecture.test.mjs` 守分层规则与无环（ADR-0001、ADR-0002）。

## Consequences

- 门禁是可信的：它不会因为一个红 runner 而少跑，也不会因为 flag 而少跑用例。
- 代价：e2e 需要本地 chromium（`playwright-core install`），CI 要多一步安装；`npm run check` 比只跑单测慢（单测约 20s，e2e 更久）。
- 无 `--test-force-exit` 意味着句柄泄漏会**挂起**而不是失败，所以 CI job 设了 `timeout-minutes: 20` 兜底——这是有意的取舍：宁可超时红，也不要绿着少跑。
