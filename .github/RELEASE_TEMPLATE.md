# Release notes template

本文件是 GitHub Release 正文的**唯一格式来源**。发版时照抄下面的骨架填写，不要再去翻历史 release 反推格式——历史上格式漂过好几次（`中文 / English` → `主要变更 / 验证` → 直到 v1.6.1 才稳定成现在的四段双语 + 对比链接）。

- Release 标题 = tag 名 = `v<package.json version>`；tag 必须与 manifest 的 version 一致。
- 正文**必须中英双语**：中文段在前，`---` 分隔，英文段在后；两段内容一一对应，不是摘要。
- 两段都以 compare 链接收尾：`https://github.com/xbzbing/dsh-git-panel/compare/<PREV>...<TAG>`，`<PREV>` 是上一个 tag。
- 不要保留 GitHub 自动生成的 `## What's Changed` 段落，它和这里的结构冲突。
- 历史 release 只读不改；格式统一从现在这版开始。

## 写作规则

**主要变更**

- 一条一个用户可感知的结果，标题加粗，冒号后写「现在是什么样 / 为什么值得升级」，不是实现流水账。
- 末尾用 `（#N）` 关联 issue 或 PR；没有关联就不写。
- 顺序：面向用户的能力与修复在前，`**内部**` 类的约定 / 门禁 / 重构放最后一条。
- 不要写：版本号变更、`lib/` 重建、纯格式调整、仅测试内部改名且不改变任何保证的改动。

**验证**

- 写**当次** `npm run check` 的真实输出：单测数、e2e runner 数、产物一致性检查结果。数字不得沿用上一版（历史 release 里出现过前一版的单测数）。
- 再写 1–3 条最有判别力的回归：修了什么、哪条测试会在去掉修复后转红。
- 没有新验证内容时，宁可只留 `npm run check` 一行，也不要编。

**篇幅**

| 版本类型 | 中文条目数 |
| --- | --- |
| patch（修 bug / 文档） | 1–4 |
| minor（新能力） | 5–10 |
| major | 按需分组，每组一个小标题 |

## 骨架

<!-- 从下一行开始复制到 release 正文 -->

## 主要变更

- **<用户可感知的标题>**：<现在是什么样、为什么值得升级>（#<issue 或 PR>）
- **<标题>**：<说明>
- **修复**：<修掉的现象与影响面>（#<N>）
- **内部**：<约定 / 门禁 / 结构性改动>

## 验证

- `npm run check` 全绿：typecheck + <N> 单测 + <M> 个 e2e runner + 产物一致性
- <关键回归：修了什么；去掉该修复后哪条测试转红>

[完整变更记录 <PREV>...<TAG>](https://github.com/xbzbing/dsh-git-panel/compare/<PREV>...<TAG>)

---

## English

- **<Title>**: <what it does now and why it is worth upgrading> (#<issue or PR>)
- **<Title>**: <description>
- **Fixes**: <the symptom and its blast radius> (#<N>)
- **Internal**: <conventions / gates / structural changes>

## Verification

- `npm run check` green: typecheck + <N> unit tests + <M> e2e runners + built-artifact consistency
- <key regression: what was fixed and which test turns red without it>

[Full changelog <PREV>...<TAG>](https://github.com/xbzbing/dsh-git-panel/compare/<PREV>...<TAG>)

<!-- 复制到上一行结束 -->

## 填写素材

```bash
# 上一个 tag 到 HEAD 的提交（合并提交已排除，release 里不列）
git log --oneline --no-merges "$(git describe --tags --abbrev=0 HEAD^)"..HEAD

# 当次门禁的真实数字
npm run check
```

## 发布流程

发布由 `.github/workflows/release.yml` 在「version bump 合入 main」时执行；正文不再是发布那一刻手写的，而是**随发版提交一起入库**的文件：

```bash
# 1. 发布说明：照上面的骨架填 docs/releases/v<v>.md，和代码一起提交、一起 review
$EDITOR docs/releases/v<v>.md

# 2. 版本号：同时更新 package.json 与 package-lock.json 的两处 version
#    预发布用带 - 的版本（1.8.0-rc.1）：只发 GitHub，不发 npm
#    正式版用纯 semver（1.8.0）：发 npm + 稳定 Release
npm version <v> --no-git-tag-version
git add package.json package-lock.json docs/releases/v<v>.md && git commit -m "chore: release v<v>"

# 3. 产物：src/ 与 lib/ 必须同一个提交
node build.mjs
git add lib/ && git commit -m "chore: build lib for v<v>"
```

合入 main 后 workflow 自动完成：门禁 → 打 tag →（仅正式版）`npm publish` → GitHub Release（附同一个 tgz；预发布带 `--prerelease`）。不要手工在 main 上打 tag。

workflow 在动手之前先校验：`docs/releases/v<v>.md` 必须存在、`npm run check` 必须全绿；任何一条不满足就停在发布之前。npm 已存在同版本、远端已有 tag、已有 Release 时相应步骤自动跳过（Release 改为更新正文），所以失败后可以直接重跑：

```bash
gh workflow run release.yml
```

手工在网页上改正文而不改 `docs/releases/v<v>.md`，下次重跑会被文件内容覆盖。预发布版本号含 `-`，GitHub 会标为 prerelease、`releases/latest` 不返回它，版本条不会提示「有新版本」；正式版发布后 npm 与稳定 Release 同时上线。
