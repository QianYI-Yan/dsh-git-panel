# ADR-0014：AI 生成提交信息的语言与预算

- 状态：Accepted（2026-10-18，迁移自现有实现）
- 相关：`src/host/suggest.ts`、`src/host/llm-face.ts`、`test/unit/suggest.test.mjs`

## Context

「AI 生成提交信息」有三个容易做错的地方，每一个都有实测教训：

1. **语言**。界面语言不等于提交语言。中文界面的用户在英文仓库里工作，应该得到英文提交信息。更糟的是：仓库里如果有一批自动生成的英文提交（release / merge / revert），按「近期提交」推断会把结论翻成 `en`，即使作者本人一直写中文。
2. **模型解析时机**。`llm` 服务与默认模型如果写进 `static inject` 或在构造期冻结，用户在设置里换了模型不会生效。
3. **预算与截断**。压缩产物（minified bundle）里的超长行会吃光 token 预算，把真正有信息量的 diff 挤出去。

另外一条经验：**语言要求只写在 system 里不够**，模型仍会输出错误语言。

## Decision

- `llm` / `agentDefaultModel` **按请求解析**（`getLlm` / `getAgentDefaultModel`），不在构造期冻结、不进 `static inject`；模型路由 config 覆盖（provider/model 必须成对）优先，否则用 `agentDefaultModel.currentSelection()`。
- **语言默认 `auto`**：按仓库自身近期提交推断；**先滤掉机械提交**（release / merge / revert / `fixup!` / `squash!`），本人提交足够时只看本人；**不跟随界面语言**。
- **语言要求同时写进 system 和 user 消息末尾的独立 text block**，且该 block 位于 diff 截断预算之外。
- **diff 进预算前先折叠超长行**（压缩产物会吃光预算），但**结构性行一律不折**（`@@`、`diff --git`、`---`/`+++` 等承载 hunk 坐标）；**折叠不算截断**，不计入 ADR-0013 的截断标记。
- 配置面提供开关、生成语言、输入预算 / 输出上限 / 超时，范围与 host 实际执行范围从同一处派生（ADR-0002）。

## Consequences

- 中文用户的英文仓库得到英文提交信息；自动生成的英文提交不再污染语言推断。
- 代价：`auto` 的推断逻辑本身需要维护（机械提交的过滤名单、本人提交的阈值），且有单测锁定。
- **请求构造单测不代表模型遵循率**：单测只能证明「语言要求写进了两个位置」，真实遵循率必须经官方适配器 + 真实模型验证。**禁止用手工重组的 HTTP 请求替代官方适配器验证**——那条路绕过了真实的请求组装，验证结果不成立。
