# ADR-0010：可见性门控与按需查询

- 状态：Accepted（2026-10-18，迁移自现有实现）
- 相关：`src/client/visibility.ts`、`src/client/use-page-visibility.ts`、`src/client/use-visible-request.ts`、`src/client/query-key.ts`

## Context

面板是常驻的：用户切到「对话」、切到别的浏览器标签、或把面板折叠，Git 页签都还挂载着。两种浪费随之出现：

- **后台轮询**：页面不可见时继续拉快照、继续跑子查询，纯烧 git 进程。
- **急切读取**：历史、diff、文件内容这些大读取如果在挂载时就全量拉，一个几千提交的仓库会让面板启动变慢，而用户可能只看第一屏。

还有一个更隐蔽的问题：**在途响应的派生**。请求已经发出去了，页面此刻转为不可见，响应回来时如果照常触发下一批查询（分页、二阶段图片 diff），门控就漏了。

## Decision

- **页面后台不启动新 snapshot**；**隐藏的子页签不启动新的自动查询、分页或二阶段请求**。
- **在途响应可以完成，但不得派生后续查询**——这是门控的真正边界，不是「取消在途请求」。
- **恢复时先补新快照，再只为当前活动页签补查一次**；不做「把所有隐藏页签都补一遍」。
- **按需查询**：history / branches / show / diff / image-diff / file-content 等走 `query` 端点，带分页、缓存与**分代防竞态**（新请求接管、旧响应按代丢弃）；请求等待或失败时**保留上一份完整数据**，不闪空态。
- 实现收口在 `useVisibleRequest` / `useGitQuerySignal` / `query-key.ts`：查询键是结构化的，可见性作为独立入参，不混进业务键。

## Consequences

- 后台开销有界；恢复交互时数据是「补一次」而不是「全量重拉」。
- 代价：查询生命周期分散在几个 hook 里，**集成测试必须从同一个 bundle 导入 controller 与 hooks**，否则 `pageVisibility` 单例会分裂成两份、门控看起来生效其实没有。这条写在 `AGENTS.md` 的构建节里。
- e2e 断言了 `visibilityNoHiddenImageStage`、`visibilityWaitsForSnapshot`、`visibilityOverviewCatchup` 等具体行为——门控不是靠注释保证的。
