# ADR-0021：发布正文归档只收正式版

- 状态：Accepted（2026-10-20）
- 相关：`.github/PRERELEASE_BODY.md`、`.github/RELEASE_TEMPLATE.md`、`docs/releases/`、`.github/workflows/release.yml`、`test/unit/release-notes.test.mjs`、ADR-0019

## Context

ADR-0019 让每一版——包括 rc / alpha——都在 `docs/releases/` 留一份正文，正文里的变更条目与随后的正式版写的是同一批改动。实际跑下来暴露三个问题：

- **同一批改动在档案里写两遍**：rc 的归档正文先列一遍 `v1.7.0..rc` 的改动，正式版再列一遍。两份都由人维护，措辞一改就漂移，评审也要读两遍。
- **rc 的归档正文没有读者**：预发布只用于自测与隔离 profile 验证，`releases/latest` 不返回它，版本条不提示，安装靠命令行的附件 URL；它要的是「这版能不能装、测什么」，而不是一份会被下一次正式版覆盖的完整账。
- **仓库里堆的是过程产物**：`docs/releases/` 应当是「这个正式版交付了什么」的索引；混进 rc 之后，读者得先分清哪些是稳定版的账、哪些只是候选版本的中间状态。

## Decision

- `docs/releases/` **只存正式版正文**（`v<major>.<minor>.<patch>.md`）。rc / alpha 不写、也不留存，文件名不带 `-`；`test/unit/release-notes.test.mjs` 按文件名逐份把关。
- 预发布的 Release 页面**照常写完整变更记录**，但**不归档**：workflow 先用 `.github/PRERELEASE_BODY.md` 的固定说明把页面建出来（一句「本版为预发布，只用于自测」+ 本版附件安装命令，`<TAG>` / `<VERSION>` 由 workflow 替换），随后用 `gh release edit --notes-file <本地文件>` 写入正文。正文放本地（如 `docs/local/releases/v<v>.md`，不入库），按正式版的四段双语结构写，安装段只给附件。
- **归档只记一次**：正式版与上一个**正式版** tag 比，范围已覆盖 rc 期间的全部改动，历史档案因此不丢信息，也不重复。
- workflow 的正文来源分支：正式版读 `docs/releases/v<v>.md`（缺文件在打包前失败）；预发布用固定说明建页。幂等重跑时正式版按文件重建正文，**预发布保留已经手写好的正文**，不被占位说明覆盖。

## Consequences

- 历史档案（`docs/releases/`）只回答「这个正式版交付了什么」；rc 页面为当时的自测者而写，不背历史账，也不会有两份措辞漂移的副本。
- 代价：预发布正文不进仓库，也就不在 PR 里评审——靠发布者按模板写；仓库只保留占位说明这一份格式来源。页面从占位说明到手写正文之间会短暂不一致（通常几秒到几分钟）。
- 已发布的 `v1.8.0-rc.1` 页面保留原正文；仓库里对应的归档文件已删除，重跑 workflow 也不会改写它的正文。
- `test/unit/release-notes.test.mjs` 增加两条守卫：`docs/releases/` 不允许出现带 `-` 的文件名；占位说明必须双语、保留 `<TAG>` / `<VERSION>` 占位符、不含变更条目、不出现 npm。
