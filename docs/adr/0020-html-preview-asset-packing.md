# ADR-0020：HTML 预览的相对资源打包

- 状态：Accepted（2026-10-19）
- 相关：`src/client/html-pack.ts`、`src/client/FilesTab.tsx`、ADR-0015

## Context

文件浏览的 HTML 渲染预览走 `allow-scripts` 且不带 `allow-same-origin` 的 iframe（ADR-0015），字节经 `srcdoc` 注入。但 `about:srcdoc` 文档没有自己的 URL，相对引用按父页面（GUI）地址解析：设计稿里 `<link rel="stylesheet" href="../../../src/renderer/src/styles.css">` 这类相对 CSS 会被解析到 GUI 源上 404，从未指向工作区文件——页面能跑但永远没有样式。

官方 `documentpreview` 的交互式 HTML 走 `packHtml`：把相对引用的 `.css` / `.js` 读出来、改写成 blob URL 后再放进隔离 iframe。dsh-git-panel 此前只有隔离、没有资源解析。

## Decision

- **镜像官方 packHtml**（`src/client/html-pack.ts`）：
  - 用惰性 `<template>` 解析收集 `script[src]` / `link[rel~=stylesheet][href]`——不在父页面执行或挂载元素；存在 `<base href>` 时整包跳过（URL 解析交给浏览器）；只打包直接的经典 `.js` 脚本与 `.css` 样式表，`url()`/`@import`、module、动态构造的 URL 不支持。
  - 引用必须是相对路径（拒绝 scheme、绝对路径、`\`、NUL）；剥掉 query/fragment，百分号转义只解码一次；`.`/`..` 就近解析，逃逸浏览根即拒。
  - 上限与官方一致：单资源 4 MiB、整包 32 MiB（含页面字节）、64 个资源。
  - **全有或全无**：任一引用解析失败、读取失败或超限即放弃整包，回落到原始字节——即改造前的行为，失败不改变现状。
- **资源读取走 host 已有的 `file-content` 端点**：客户端把引用解析成工作区相对路径后经 RPC 读取，host 侧 `isSafePath` + realpath 包含检查兜底；不新开信任边界，也不改 wire 类型。
- **bootstrap 注入**：打包产物是「固定脚本 + base64 JSON 负载」的 bootstrap 文档作为 `srcdoc`；脚本在 **iframe 内**为每个资源建 blob URL（不透明源装不进父页面创建的 blob），改写匹配的 `link`/`script` 属性后 `document.write` 页面。资源文本只以 base64 JSON 进入 iframe，页面字节不可能击穿引导脚本。
- **只在渲染模式打包**：HTML 默认源码视图，选中文件不触发额外读取；打包进行中保留上一份预览（源码视图），不闪未样式化页面。

## Consequences

- 相对 css/js 在预览里生效（如 `docs/local/…/mock.html` 引用仓库根的 `styles.css`），隔离边界与 ADR-0015 完全一致。
- CSS `url()` 内的相对图片、ES module、动态 URL 仍不解析（镜像官方范围）；这些引用在 iframe 内解析失败，但不影响其余已打包资源。
- 一次渲染最多 64 次额外 `file-content` RPC；打包失败静默回落到原始字节（页面仍完整可读，只是没有新样式）。
- 官方改 `packHtml` 的收集规则或上限时，`html-pack.ts` 必须跟着改；`test/unit/html-pack.test.mjs` 与 e2e 的 `styled.html` / `unpacked.html` 夹具锁定当前行为。
