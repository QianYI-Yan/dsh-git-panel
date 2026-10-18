# ADR-0016：客户端渲染性能约定

- 状态：Accepted（2026-10-18，迁移自现有实现）
- 相关：`src/client/virtual-list.ts`、`src/client/use-viewport.ts`、`src/client/highlight-cache.ts`、`src/client/ImageZoom.tsx`

## Context

这个面板要渲染的是「可能很大」的数据：几千行的文件、几千个变更、上百个提交、高分辨率图片。同时 React 的浅比较与浏览器的事件模型有几个**反直觉的坑**，踩了以后性能或交互会静默变差。

具体三类问题：

1. **挂载量**：长列表如果全量挂载，DOM 节点数与语法高亮开销都随文件大小线性增长（ADR-0012 的实测：8456 个节点）。
2. **memo 失效**：`memo` 组件如果 props 里出现渲染期新建的对象字面量，浅比较永远不等，整套高亮白缓存。
3. **图片缩放的 CSS/事件陷阱**：`.gp-zoom__img` 不加 `flex:none` 时，放大超过 100% 不生效（flex 收缩把图压回去）；拖拽用 `setPointerCapture` 会改写 click 的目标，导致「拖完松手」被当成点击。

## Decision

- **长列表虚拟化**：变更列表、源码视图、DiffView 一律用 `virtual-list.ts` + `use-viewport.ts`；查找跳转到窗口外命中时**窗口吸附到命中邻域**，不挂载中间的连续区间。
- **`memo` 组件的 props 传普通值**，不在渲染中新建对象字面量。
- **逐行高亮经 `highlight-cache.ts` 缓存**，按行文本复用。
- **图片缩放**：`.gp-zoom__img` 必须 `flex:none`；拖拽的 pointer 事件**挂 window 且不 `setPointerCapture`**。
- 固定行高（`VROW_H` / `EST_CODE_H` 等）让窗口数学精确；换行导致的行高变化靠挂载行实测回填。

## Consequences

- 大文件与长列表的挂载量被视口限制，主线程不再被高亮阻塞。
- 代价：虚拟化引入「估算行高 → 实测回填」的复杂度；行高常量与 CSS 必须保持一致，改一边要改另一边。
- 这些约定属于「不读代码看不出来、违反就会静默变差」的类型，因此同时写在 `AGENTS.md` 的 UI 约定里。
