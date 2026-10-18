# ADR-0003：安装端零构建、禁止安装期脚本与安装身份

- 状态：Accepted（2026-10-18，迁移自现有实现）；**「`lib/` 入库」部分已退出，由 [ADR-0018](0018-distribution-channels.md) 取代**
- 相关：`.gitignore`、`package.json`、`cordis.patch.yml`、`build.mjs`、`test/unit/plugin-contract.test.mjs`、`test/unit/lock-sync.test.mjs`、ADR-0018

> **有效期说明**：本 ADR 的稳定不变量是「安装端零构建」「禁止安装期生命周期脚本」「安装身份三处一致」「产物新鲜度有门禁」。其中**「产物入库（`lib/` 提交到 main）」是已退出的过渡期实现**——`lib/` 已移出 main，GitHub 安装改走 Release 附件，见 ADR-0018。下文保留当时的完整论证，因为它解释了为什么 `prepare` 被否决，那条结论在退出之后依然成立。

## Context

插件有两种安装路径：npm registry 与 `dsh plugin add github:xbzbing/dsh-git-panel`。后者只把仓库 clone 下来，**不在安装端构建**；插件入口（`main` / `exports`）指向 `lib/`，仓库里没有产物就等于装了个空壳。

「让安装端自己构建」的常规做法是挂 `prepare` 生命周期钩子。三条约束否掉了它：

1. pnpm 从 10 起默认不执行依赖的构建脚本，git 依赖的 `prepare` 会直接报 `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`，需要用户把包加进 `allowBuilds` 白名单——安装不再是无人值守的一条命令。
2. DSH 插件管理器把构建脚本审批做成显式的人工步骤（`pendingBuilds` / `approvedBuilds`），且脚本以宿主用户权限执行。
3. DSH STORE 的上架契约拦截声明安装期脚本的插件。

此外安装身份有三个必须一致的字面量，历史上任一处不一致都会让面板整个消失：`package.json.name`、`cordis.patch.yml` 的 row `name`、`build.mjs` 产出的 ModuleLoader 注册 `id`。

## Decision

**稳定不变量**（`lib/` 移出后依然成立）：

- **安装端零构建**：任何渠道的安装都不在用户机器上执行构建；插件入口指向随包分发的产物。
- **不挂任何安装期生命周期钩子**：`preinstall` / `install` / `postinstall` / `prepare` / `prepublish` / `prepublishOnly` / `prepack` / `postpack` 一律不出现在 `scripts` 里；构建只作为显式脚本 `npm run build` 存在。
- **安装身份三处一致**：`package.json.name` = `cordis.patch.yml` 的 row `name` = `build.mjs` 产出的 ModuleLoader 注册 `id`。
- **产物新鲜度有门禁**：产物与源码不得漂移，由门禁而非自觉保证。

**已退出的过渡期实现**（由 ADR-0018 取代，`lib/` 已移出 main）：

- 曾将 `lib/` **提交入库**；改动 `src/` 后手动 `node build.mjs` 并把 `lib/` 一起提交。测试期 bundle（`lib/testkit.mjs` / `lib/hookkit.mjs`）gitignore，由 `npm run test:unit` 重建。
- 守卫：`plugin-contract.test.mjs` 断言没有安装期脚本、安装身份三处一致、`lib/host` 的每个相对 import 都能在产物里解析；`npm run check` 与 CI 曾用 `git diff --exit-code -- lib/` 断言产物新鲜（已随移出删除）；`lock-sync.test.mjs` 断言 lock 与 manifest 同步。
- 曾约定 **`lib/` 冲突一律以重建解决**，不手工合并压缩产物——移出后该问题不复存在。

## Consequences

- GitHub 直装开箱可用，安装端零构建、零脚本执行权限。
- 代价曾是**产物进版本库**：任何 `src/client/` 改动都会改写压缩后的 `lib/client.js`，并行分支必然冲突，冲突只能以「重新构建」解决、不能手工合并；`lib/client.mermaid.js` 单独 5.0 MB（ADR-0004）。这直接抬高了大规模重构的成本——`lib/` 已移出 main（ADR-0018）。
- 忘记重建不会被忽略：本地 `npm run check` 与 CI 都会红。
- 发版必须让 manifest、lock、产物三者同一步调（流程见 ADR-0019）。
