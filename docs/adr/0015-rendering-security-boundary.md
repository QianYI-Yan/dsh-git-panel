# ADR-0015：渲染安全边界：HTML / Markdown 图片 / mermaid

- 状态：Accepted（2026-10-18，迁移自现有实现）
- 相关：`src/client/FilesTab.tsx`、`src/client/path-images.ts`、`src/client/MermaidFigure.tsx`、`src/client/mermaid-blocks.ts`；HTML 相对资源打包（css/js → blob URL）见 ADR-0020

## Context

文件浏览要渲染**仓库里的内容**，而仓库内容是别人写的、不可信的。三条路径各有风险：

- **HTML 文件**：直接渲染会在宿主页面里执行任意脚本，能拿到 DSH 的会话、storage 与同源网络。
- **Markdown 里的图片**：相对路径的图片要能显示（README 的截图），但解析必须与宿主的文件路由一致，否则要么显示不出来、要么指向错的文件。
- **mermaid 图表**：需要引入一个体积巨大的依赖，而绝大多数会话用不到。

另有一个平台约束：平台的 `MarkdownText` **刻意转义内联 HTML**（这是它防 XSS 的设计），所以 `<kbd>` 这类标签不会生效。

## Decision

- **HTML 预览走 `allow-scripts` 的隔离源 iframe，且不带 `allow-same-origin`**：文档落在唯一的不透明源里，够不到 DSH 父页面、它的 storage 与同源网络；`srcDoc` 让页面字节留在文档内（不发额外请求）。相对 css/js 由 ADR-0020 的打包器经 host 文件路由读出后改写为 iframe 内 blob URL——仍不发起网络请求，隔离边界不变。
- **Markdown 本地图片经官方 `pathImages.resolve` 契约**解析到宿主的认证文件路由（`api/file?path=…`）：解析逻辑**一对一镜像官方文档预览的 `markdownImageUrl`**（解码一次、拒绝 scheme、贴着文档所在目录拼接、wire 上只接受绝对路径）。**偏离这个实现会让路径解析到宿主路由随后拒绝的位置**。
- **mermaid 走懒加载 chunk**：`lib/client.mermaid.js` 由 `/plugins` 路由按需下发，**主 bundle 里只允许一个引用点**（`MermaidFigure.tsx` 的 `require.async`）；渲染失败**回退为代码块**，不留空白。
- 因为 `MarkdownText` 转义内联 HTML，`<kbd>` 只能在**送入前做文本替换**（`mermaid-blocks.ts`），且**围栏与行内代码内不替换**。

## Consequences

- 渲染不可信内容不会拿到宿主权限；HTML 页面仍可交互（`allow-scripts`），但困在不透明源里。
- 代价：iframe 里的页面无法访问同源资源，某些依赖同源的 HTML 会表现异常——这是刻意的取舍。
- 图片解析与官方实现是**复制关系而非复用关系**：官方改了 `markdownImageUrl`，这里必须跟着改。`test/unit/path-images.test.mjs` 锁定当前行为。
- mermaid chunk 让主 bundle 保持轻量，但把 5.0 MB 放进 `lib/` 与 npm 包（ADR-0004）。
