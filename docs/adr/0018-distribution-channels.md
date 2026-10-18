# ADR-0018：分发渠道与产物来源

- 状态：Accepted（2026-10-18）
- 相关：`.github/workflows/release.yml`、`scripts/assert-pack.mjs`、`package.json` 的 `files`、ADR-0003、ADR-0019

## Context

`lib/` 入库只服务一条路径：`dsh plugin add github:xbzbing/dsh-git-panel` 直接拿仓库树、不在安装端构建（ADR-0003）。代价随规模上升：

- 247 个提交里 **116 个改动 `lib/`**；压缩后的 `lib/client.js` 让并行分支**必然冲突**，而冲突只能以重建解决；
- 每个 PR 都必须带新鲜产物，架构重构会把这个成本放大；
- `lib/client.mermaid.js` 单独 5.0 MB，npm 包 1.6 MB。

「让安装端构建」不可行（pnpm 拦截 git 依赖的构建脚本；dsh 把脚本审批做成人工步骤；STORE 上架契约禁止安装期脚本）。

需要的是：**main 不再提交产物，但 GitHub 侧仍可安装，且各渠道拿到同一份经门禁验证的产物。**

## Decision

- **npm 是正式发布主渠道**：`dsh plugin --profile web add @xbzbing/dsh-git-panel@latest`。
- **GitHub Release 附件是预发布渠道**：正式版与预发布版都把 `npm pack` 的 tgz 作为 Release 资产；`dsh plugin add <tgz URL>` 直接安装。预发布（版本号含 `-`，如 `1.8.0-rc.1`）**只发 GitHub、不发 npm**——GitHub 服务端的 `releases/latest` 本就排除 prerelease，版本条零改动。
- **不再引入 `dist` 分支**。曾规划 CI 维护一个 `dist` 分支承载产物树，以便 `github:…#dist` / `#vX.Y.Z` 简写安装；已否决，理由见下。GitHub 安装路径统一为 Release 附件 URL。
- **各渠道共用同一个 `npm pack` 产物**：`package.json` 的 `files` 是唯一清单，Release 附上同一个 tgz。
- **`lib/` 离开 main 是后续独立 PR**：本 ADR 生效后 main 仍提交 `lib/`（`github:xbzbing/dsh-git-panel` 短装仍可用）；`lib/` 移出在本 PR 合并后按新流程单独执行，届时 `.gitignore` 加 `lib/`、`git rm -r --cached lib`、`npm run check` 与 CI 去掉产物 diff 检查。

**被否决的选项**：`prepare` 钩子（三条约束，见 ADR-0003）；只保留 npm（丢掉 GitHub 安装路径）；CI 维护 `dist` 分支（`lib/` 冲突问题原样保留，只是换了个提交者；`#dist` 与 `#vX.Y.Z` 简写安装从未有真实用户，收益为零；还让 Release 的 Source code 压缩包失去源码语义）；CI 机器人把 `lib/` 提交回 main。

**已确认的前提**（2026-10-18）：DSH STORE **不作为约束**——它不是标准发布渠道，按正常发布走。GitHub Release 的 Source code 压缩包保持源码语义（tag 打在 main 的发布提交上，不再打在产物树上）。

## Consequences

- main 的 diff 只剩源码；并行分支不再撞压缩产物；重构成本回到正常水平。
- 代价：GitHub 安装必须写完整 Release tgz URL，没有 `github:…#dist` 简写——**接受**，没有存量简写用户。
- 不带 ref 的 `github:` 安装（`github:xbzbing/dsh-git-panel`）在 `lib/` 移出 main 后会拿到无 `lib/` 的树、面板消失。**无存量用户**（github 安装仅用于作者自己的开发测试），移出 `lib/` 的 PR 里同步更新 README 安装说明即可，不需要公告期。
- 预发布不触发版本条「有新版本」提示：`releases/latest` 服务端排除 prerelease，预发布只用于作者自测与隔离 profile 验证。正式发布时 npm 与稳定 Release 同时上线，版本条照常工作。
- 已核对的支撑事实：`parseInstallSpec` 把 Release 附件 URL 判为 tarball 安装、把 `github:…` 判为 git 安装；`npm pack` 是确定性的（同源码两次打包 sha256 相同）；draft Release 的资产需要鉴权（404），已发布的 prerelease 资产公开可下——所以 workflow 只创建已发布的 prerelease，从不创建 draft。
- 回滚：删 `release.yml` 即可；`lib/` 移出后如需回退，还原清单 PR（重新入库 `lib/`）。npm 版本不可回收，出问题发补丁版。
