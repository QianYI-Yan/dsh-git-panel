# AGENTS.md

本文件是 `dsh-git-panel` 仓库的 agent 工作指南。任何在此仓库工作的 AI agent 或贡献者，动手前先读完本文件，并遵守其中的架构边界、构建流程与工程约定。功能与交互细节以代码和测试为准；这里只记录不读代码难以发现、违反就会出错的约定。

## 项目定位

`dsh-git-panel` 是 DeepSeek Harness（dsh）的插件，在 Web GUI 里提供 Git 面板（许可：MIT）：

- 工作区常驻面板 tab「Git」（位于「对话」「轨迹」之后），含三个子 tab：
  - **Git 总览**：分支树 / 提交历史图（搜索、作者、时间、分支筛选）/ 提交详情；提交操作（revert、reset、标签）、分支切换与远程同步（fetch / pull-ff / push / publish）。
  - **变更记录**：未提交变更（暂存、放弃、提交、Amend、AI 生成提交信息）、贮藏、文件差异（统一 / 并排、图片对照）。
  - **文件浏览**：工作区目录树 + 文件预览（语法高亮、Markdown/HTML 渲染、图片缩放、属性）。非 Git 目录或系统未安装 git 时只显示此页，以 cwd 为根。
- 输入框左侧 zsh 风格标记 `<仓库名> (<分支>)`：绿=已同步、橙=有待提交，点击跳转面板。插件详情页可隐藏标记，隐藏时改在「Git」标签旁显示同色状态圆点（`tab-dot.ts`），两者互斥。
- 插件详情页配置表单（`PillConfig.tsx`）：标记开关、diff 默认视图、提交图线条样式、AI 生成提交信息（开关、语言、输入预算 / 输出上限 / 超时）。写入被接受后立即 `resyncAll()`。
- 面板宽度 ≤620px（`layout.ts` 的 `COMPACT_BP`）进入 compact 单栏「钻取」布局。

## 架构总览

插件分 host / client 两半，经 typert Remote 通信。

```
Client 半 (React bundle, lib/client.js)
  - conversation.view (order 30)  → Panel 主面板（内部子 tab 路由）
  - conversation.input.left       → GitPill（zsh 风格标记）
  - plugins.bundle.config         → PillConfig（详情页配置表单）
  - GitController                 → 每 session 页面可见时轮询 snapshot，pill/变更页/统计共享
        │ RPC (typert)
        ▼
Host 半 (Cordis + typert, lib/host)
  - GitPanelService（命名空间 gitPanel）
        - snapshot / run / query / suggest / version 五个 @Remote 端点
        │ subprocess 服务（argv 数组、无 shell、cwd 锁仓库根、超时+输出上限）
        │ suggest 端点另经宿主 llm 服务一次性生成提交信息
        ▼
  git CLI
```

### Host（`src/host/`）

- `types.ts`：wire 数据模型的**唯一权威源**，client 侧 RPC 类型直接复用。
- `index.ts`：`GitPanelService`，只做端点委托与生命周期接线。
- `git.ts`：把 `subprocess` 适配成带超时的 `GitRunner`；每条命令注入 `GIT_TERMINAL_PROMPT=0`，网络命令遇凭据 / 主机密钥交互时快速失败而非挂到超时。
- `fs-deps.ts`：`SnapshotDeps` fs 面的唯一来源（`createFsDeps()`），host 服务与 `host-integration` 单测共用，不得另写一份，否则测试不再是对生产的断言。
- `core.ts`：仓库根解析（realpath）+ `snapshotForSession`；`resolveBrowseRoot` 在非 Git 目录回退到 cwd。
- `snapshot-fingerprint.ts`：快照的 `stateFingerprint`（键排序后 SHA-256，排除 `checkedAt`）。
- `actions.ts`：`GitAction` → git 命令序列，以及 git 输出 → 错误码映射（冲突、`index-busy`、`not-found`、`auth-failed`、`push-rejected`、`not-ff` 等，兜底 `git-error`）。
- `queries.ts`：`query` 端点的各类按需查询（history / diff / file-lines / image-diff / dir-list / file-content / show / branches / tags / stash-list / authors / pull-preview / push-preview 等）。
- `history-topology.ts`：筛选后的历史页追加一次有界无过滤父链（10000 节点 / 2 MiB），失败只退化祖先数据，不丢列表。
- `validate.ts`：信任边界输入校验。
- `suggest.ts` / `llm-face.ts`：AI 生成提交信息；`llm-face.ts` 用 `@deepseek-ai/dsh-llm` type-only 类型钉住 wire 契约。
- `remote.ts` / `parser.ts` / `version.ts`：远程 URL → 浏览链接、git 输出解析、版本与更新检查。

### Client（`src/client/`）

- 入口与通信：`index.ts`（注册三个 slot + i18n）、`rpc.ts`（`gitPanel/<method>` 的 client 面，异常降级为类型化 failure）。
- 快照与刷新：`controller.ts`（`GitController`）、`registry.ts`（per-session 复用池，最后一份引用释放后 60s 回收）、`visibility.ts` / `use-page-visibility.ts`、`use-git-query-signal.ts`、`use-visible-request.ts`、`query-key.ts`。
- 页面：`Panel.tsx`（子 tab 路由、字号、版本条）、`OverviewTab.tsx` + `overview-hooks.ts` / `overview-statusbar.tsx` / `overview-modals.tsx`、`ChangesTab.tsx` + `changes-hooks.ts` / `ChangesToolbar.tsx` / `ChangeStats.tsx`、`DiffView.tsx` + `image-diff-hook.ts` / `ImageCompare.tsx`、`FilesTab.tsx`、`GitPill.tsx`、`PillConfig.tsx`。
- 纯算法（有单测）：`branch-tree.ts`、`git-graph.ts`、`filtered-graph.ts`、`file-tree.ts`、`diff.ts`、`code-spans.ts`、`virtual-list.ts`、`zoom.ts`、`discard-targets.ts`、`branch-options.ts`、`push-policy.ts`。
- 共享 UI 原语：`ops-modals.tsx`（弹窗外壳 / 确认框 / 错误码文案）、`dialog-focus.ts`（模态焦点生命周期）、`tip.tsx`（悬浮提示）、`notice.tsx`（可关闭提示条）、`use-viewport.ts`、`highlight-cache.ts`、`ImageZoom.tsx`。
- 测试入口：`testkit.ts` / `hookkit.ts`（见「构建」）。

## 安全与信任边界

- git 命令一律用 argv 数组经 subprocess 执行，禁止拼接 shell 字符串；cwd 锁仓库根，带超时与输出上限。
- 经 RPC 到来的 path / ref / 分支名 / 标签名 / remote 名是唯一不可信的 argv 素材，必须先过 `validate.ts`（`isSafePath` / `isSafeRev` / `isSafeBranchName` / `isSafeRemoteName`）；子命令支持时再用 `--end-of-options` 殿后。`checkout` / `reset` 不认该选项（旧 git 会直接失败），只靠校验兜底。贮藏 index 在 `actions.ts` 校验为非负整数。
- `dir-list` / `file-content` / 未跟踪文件删除是插件唯一直接触碰未跟踪文件的入口：`isSafePath` + realpath 包含检查，软链指向仓库外一律拒，`.git` 不可浏览。
- 远程链接（`remote.ts`）必须剥除 URL 内嵌凭据，避免 token 泄进 href。
- 写操作不越权：push 绝不 `--force` 且仅在严格领先时提供；pull 只走 `--ff-only`；分叉时 push / pull 都不提供；绝不直接检出远程引用（落为同名跟踪分支，避免游离 HEAD）；publish 的 `HEAD`、pull-preview 的 `@{upstream}` 为固定字面量。
- 放弃未跟踪条目由 host 直接删盘（`git restore` 摸不到）：任何删除失败都汇总成错误返回，绝不静默；条目本身是仓库（嵌套仓库 / 子模块 / bare 布局）时整批拒绝（`nested-repo`），删除循环内逐条复检（竞态命中报 `nested-repo-partial`）；只「包含」仓库的普通目录仍整体删除——这条边界是刻意的（issue #46），单测同时锁住两者。
- 破坏性操作（discard、reset、stash-drop、删除标签、带贮藏的分支切换等）UI 必须二次确认，硬重置需列出将丢失的改动并额外勾选；「放弃更改」只作用于工作区侧，暂存侧需先取消暂存。
- HTML 渲染预览走 `allow-scripts` 的隔离源 iframe，不在宿主页面执行。

## 数据流铁律

- **快照单一来源**：pill、变更记录页、统计条共用同一 `GitController` 快照，禁止各自发起独立 snapshot。
- **业务与刷新分离**：业务摘要（`stateFingerprint`）相同只抑制业务 view 通知，不抑制查询 tick；子查询的刷新键是结构化的 `[root, tick, 本地失效]`，不得把业务 `checkedAt` 或 snapshot 对象引用当作 effect 触发器。一次 action 或采样只补一批查询。`stateFingerprint` 不代表 refs / stash 未变，总览仍按 tick 刷新。
- **按需查询**：history / branches / show / diff / image-diff 等走 `query` 端点，带分页、缓存与分代防竞态（新请求接管、旧响应按代丢弃）；请求等待或失败时保留上一份完整数据。
- **可见性门控**：页面后台不启动新 snapshot；隐藏的子页签不启动新的自动查询、分页或二阶段请求。在途响应可完成但不得派生后续查询；恢复时先补新快照，再只为当前活动页签补查一次。
- **写操作回灌**：动工作区的操作经 `onAction` 由 controller 接受新快照驱动刷新；标签操作不动工作区，以本地 `opBump` 刷新。分支切换成功后广播工作区世代（失效文件浏览缓存）并静默执行一次检查同步。
- **双层信封**：RPC 返回 `{ ok, value }` 是传输层结果，业务结果 `{ ok, value|error }` 在 `value` 内，两层都要判。
- **选择集随快照修剪**：勾选的路径在新快照中消失必须移除，否则提交序列会中止。
- **不完整数据不静默**：快照截断（`truncated` + `truncatedReason`）、未跟踪回落折叠（`untrackedCollapsed`）、统计降级（`stats.partial`）、diff 输出截断（`truncated`）、suggest 输入截断都要带标记并在 UI 用 `NoticeBar` 提示。`newLines` 为 0 表示新侧行数不可信，视图不得渲染尾部展开控件。
- **大仓库限流**（issue #16）：逐文件 fan-out 有上限（`STATS_FANOUT_LIMIT`、`UNTRACKED_NUMSTAT_LIMIT`），超限降级统计而不是每轮轮询刷出几百个 git 进程；「展开全部」上下文是有界的 `DIFF_EXPAND_CONTEXT`，不要放大到整文件。

## AI 生成提交信息

- `llm` / `agentDefaultModel` 按请求解析（`getLlm` / `getAgentDefaultModel`），不在构造期冻结、不进 `static inject`；模型路由 config 覆盖（provider/model 必须成对）优先，否则 `agentDefaultModel.currentSelection()`。
- 生成语言默认 `auto`：按仓库自身近期提交推断，先滤掉机械提交（release / merge / revert / fixup! / squash!，否则自动生成的英文提交会把结论翻成 `en`），本人提交足够时只看本人；**不跟随界面语言**。
- 语言要求必须同时写进 system 和 user 消息末尾的独立 text block（位于 diff 截断预算之外）；只在 system 强调仍会输出错误语言。请求构造单测不代表模型遵循率，需经官方适配器 + 真实模型验证，不能用手工重组的 HTTP 请求替代。
- diff 进预算前先折叠超长行（压缩产物会吃光预算），但结构性行（`@@`、`diff --git`、`---`/`+++` 等）一律不折；折叠不算截断。

## UI 约定

- 样式用 dsh 主题 CSS 变量（`--dsw-alias-*`），不硬编码颜色，保证深浅色主题一致。
- compact 样式统一挂在 `.gp-panel[data-layout="compact"]` 下；portaled 的 modal / bottom sheet 在 `.gp-panel` 之外，用自身 class 或 viewport media query 适配。
- 弹窗复用 `ops-modals.tsx`（`renderModalShell` / `renderConfirmModal` / `renderModalFooter`）与 `dialog-focus.ts`（`useDialogFocus`），关闭与焦点契约单处收口，不各写一份；在途操作用 `confirmBusy` 禁用并抑制 Escape / backdrop。
- 带 `aria-controls` 的 tab / segmented 控件必须渲染对应的 `role=tabpanel` 节点，保证引用恒可解析。
- 长列表（变更列表、源码视图、DiffView）用 `virtual-list.ts` + `use-viewport.ts` 虚拟化；查找跳转到窗口外命中时窗口吸附到命中邻域，不挂载中间的连续区间。
- `memo` 组件的 props 传普通值，不在渲染中新建对象字面量（会让浅比较失效、重跑整套高亮）；逐行高亮经 `highlight-cache.ts` 缓存。
- 图片缩放：`.gp-zoom__img` 必须 `flex:none`（否则放大超过 100% 不生效）；拖拽的 pointer 事件挂 window 且不 `setPointerCapture`（会改写 click 目标）。

## 依赖策略

MIT 协议下优先复用 dsh 官方能力，不为相同功能重复打包依赖。

- 平台模块（`react` / `react-dom` / `@deepseek-ai/*`）一律 external，由宿主提供，不打包。
- 优先用 `@deepseek-ai/dsh-client-ui-primitives` 的现成组件：代码高亮 `languageForPath` / `useCodeHighlighter`（语法色走宿主 `--shiki-*` 变量）、`MarkdownText`、`Menu`（`onSelect` 需自行关闭）、`SegmentedControl`、`SegmentedTabs`、`FileTypeIcon` 等。不额外引入 marked / dompurify 之类的同类库。
- 新用到的平台组件必须同步加进 e2e 平台桩 `test/e2e/harness.html`，否则面板在 e2e 中直接崩溃。
- 只有 dsh 平台专有逻辑（slot / typert 契约、提交图车道布局、路径折树、diff 拆行等）才自研。
- 引入新依赖前先确认宿主未提供；确需引入时 pin 精确版本写入 `package.json`。

## 构建

`build.mjs` 用 esbuild 出产物 + tsc 出类型声明：

1. `tsc -p tsconfig.build.json` 仅出 `lib/host/*.d.ts`。
2. esbuild 把 `src/host/*.ts` **逐文件**转译成 `lib/host/*.js`（`bundle: false`，与 `src/host/` 一一对应；`@deepseek-ai/*` 不打包）。host **绝不压缩**：typert 靠方法参数名反射校验参数，重命名会破坏 wire 契约。
3. esbuild 把 `src/client/index.ts` 打成 `lib/client.js`（cjs，包成 `window.__ModuleLoader__.load({id,factory})`，平台模块 external，可 minify）。

`lib/testkit.mjs` / `lib/hookkit.mjs` 是测试专用 bundle（已 gitignore，`npm run test:unit` 会重建）。集成测试中的 controller 与 hooks 必须从同一个 bundle（hookkit）导入，否则 `pageVisibility` 单例会分裂。

```bash
node build.mjs        # 全量构建 host + client + testkit/hookkit
npm run typecheck     # 类型检查
```

构建只作为显式脚本手动执行，**不挂 `prepare` 等安装期生命周期钩子**：`lib/` 入库即发布产物，DSH STORE 上架契约会拦截安装期执行脚本的插件（`plugin-contract.test.mjs` 守住）。改动 `src/` 后手动 `node build.mjs` 并把 `lib/` 一起提交。

## 验证

- host 改动：类型检查通过 + 端点逻辑单测。
- client 改动：`node build.mjs` 成功后，用隔离浏览器 / 隔离 DSH 实例加载重建后的产物验证；无 dev:web watcher 时必须重建 + 刷新。访问正在运行的 GUI 须遵守用户当次授权。
- 测试位于 `test/`：`test/unit/*.test.mjs`（`node --test`，纯算法 + host 端点）、`test/e2e/*.mjs`（隔离的 file:// 无头浏览器，绝不碰运行中的实例）。命令：`npm run test:unit` / `npm run test:e2e` / `npm test`。`test:e2e` 经 `test/e2e/all.mjs` 跑完全部 runner 再汇总失败——不要改回 `&&` 串联：首个红 runner 会吞掉后面所有 runner（曾因此让 9 个 runner 长期不执行）。
- 一键门禁 `npm run check`：类型检查 + 全部测试 + `git diff --exit-code -- lib/`（构建产物已提交且新鲜）。提交前必须通过。

## 代码约定

- TypeScript 严格模式，无隐式 any。
- 相对导入一律写 `./x.js` 后缀：同一份源码要同时产出可运行的 `lib/host/*.js` 和能解析的 `lib/host/*.d.ts`。
- 数据模型改动从 `host/types.ts` 起，client 直接复用，不存在第二份需手工同步的定义；常量范围（如 `SUGGEST_LIMITS`）同样单源，UI 与 host 校验从同一处派生。
- 新增 wire 字段保持向后兼容：旧 client 可忽略新字段，client 对旧 host 缺失字段要降级而非崩溃。
- 注释精简，只写最终实现意图，不写演进历史。
- 安装身份三处必须一致且等于包名 `@xbzbing/dsh-git-panel`：`package.json.name`、`cordis.patch.yml` 的 row `name`、`build.mjs` 产出的 ModuleLoader 注册 `id`。任一不一致，面板会整个消失（`plugin-contract.test.mjs` 守住）。

## 目录与提交

- `docs/local/` 是本地设计稿目录，已 gitignore，**不提交**。
- `lib/` **提交入库**，使 `dsh plugin add github:xbzbing/dsh-git-panel` 无需在安装端构建；仅测试期 bundle（`lib/testkit.mjs` / `lib/hookkit.mjs`）忽略。`node_modules/` 不提交。
- 只在用户明确要求时创建 commit；优先暂存具体文件而非 `git add .`。
