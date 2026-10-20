# ADR-0020：HTML 预览的进程隔离与相对资源内联

- 状态：Accepted（2026-10-19，2026-10-20 修订：交互预览改用 `blob:` 独立进程，静态预览降为可选开关）
- 相关：`src/client/html-pack.ts`、`src/client/FilesTab.tsx`、ADR-0015

## Context

文件浏览的 HTML 渲染预览走 `allow-scripts` 且不带 `allow-same-origin` 的 iframe（ADR-0015），字节经 `srcdoc` 注入。但 `about:srcdoc` 文档没有自己的 URL，相对引用按父页面（GUI）地址解析：设计稿里 `<link rel="stylesheet" href="../../../src/renderer/src/styles.css">` 这类相对 CSS 会被解析到 GUI 源上 404，从未指向工作区文件——页面能跑但永远没有样式。

初版镜像官方 `packHtml` 的交互路径：把相对 `.css` / `.js` 读出来、以「base64 JSON 负载 + `document.write`」bootstrap 交给 iframe。实测这条路径在 10 MB 的生成报告上要 ~2.0 s 才能交出页面，且全部发生在渲染主线程：父页面 `template.innerHTML` 解析（188 ms）、`JSON.stringify` + `btoa` 整篇（207 ms），iframe 内 `atob` + 解码（425 ms）、`DOMParser`（117 ms）、`outerHTML`（29 ms）、`document.write` 重新解析（~1 s）。iframe 与面板共用主线程，这段时间整个 GUI 无响应；再叠加页面自身的脚本，就是「打开大 HTML 直接卡死」。真正的病因不只是打包开销，而是 `srcdoc` 帧与面板同进程——官方用 `blob:` URL 才拿到进程隔离。

官方的 HTML 预览默认不执行脚本：静态模式用 DOMPurify 净化、插 `script-src 'none'` 的 CSP、`sandbox=""`；带脚本的交互模式由「开发者工具」设置开启（`configForms.developerTools.enabled`）。本插件选择相反：渲染视图默认执行脚本（对齐浏览器行为），静态预览由工具栏 `JS` 开关显式选择。

## Decision

- **交互预览走 `blob:` URL，不用 `srcdoc`**：带自身 URL 的沙箱 iframe 在 Chromium 里被放进**独立渲染进程**，页面脚本再重也阻塞不了面板主线程；`srcdoc` 帧留在父进程里，12 秒的报表脚本会把整个面板（和同进程的 GUI）冻住。实测同一份 1.25 MB 报告：`srcdoc` 父页面卡 12,064 ms，`blob:` 只卡 32 ms。官方 `documentpreview` 的交互模式正是 `src = URL.createObjectURL(blob)`，这是对齐它的关键，与样式打包无关。
- **静态按需**：渲染视图工具栏的 `JS` 开关切到静态模式——原文 + 头部插入 `default-src 'none'` 的 CSP，iframe 用 `sandbox=""`（没有脚本权限，srcdoc 即可，无脚本可跑）。整条路径只做一次字符串插入，10 MB 文档也只占几毫秒。
- **相对资源以 `data:` URL 内联**（替代 base64 bootstrap）：惰性解析文档 → 收集 `script[src]` / `link[rel~=stylesheet][href]` → 经 host `file-content` 读取 → 改写为 `data:` URL → 序列化一次。父页面的 `DOMParser` + `outerHTML` 就是整篇的两次解析里的第一次（另一次在 iframe 内），相对 base64 bootstrap 少掉的只是 base64 往返与 `document.write` 触发的那次重解析。文档 ≥ 2 MiB（`HTML_PACK_MAX_BYTES`）时跳过打包（用户已接受脚本成本，多一次解析与第二份 DOM 只会抬高内存）。
- **收集规则沿用官方范围**：只打包直接的经典 `.js` 与 `.css`；`<base href>` 时整包跳过；引用必须相对（拒绝 scheme、绝对路径、`\`、NUL），query/fragment 剥掉、百分号转义只解码一次，`.`/`..` 就近解析，逃逸浏览根即拒。
- **上限与官方一致**：单资源 4 MiB、整包 32 MiB（含页面字节）、64 个资源；**全有或全无**——任一引用解析失败、读取失败或超限即放弃整包，回落到原始字节。
- **资源读取走 host 已有的 `file-content` 端点**：客户端把引用解析成工作区相对路径后经 RPC 读取，host 侧 `isSafePath` + realpath 包含检查兜底；不新开信任边界，也不改 wire 类型。
- **只在渲染模式准备文档**：HTML 默认源码视图，选中文件不触发额外读取；打包进行中保留源码视图，不闪未样式化页面。

## Consequences

- 大文档也默认执行页面脚本，但脚本跑在独立渲染进程里：面板保持可操作，预览区自己空白几秒再出图（与官方一致）。不想要脚本时点一次 `JS` 回静态。
- 相对 css/js 在预览里生效（如 `docs/local/…/mock.html` 引用仓库根的 `styles.css`），隔离边界与 ADR-0015 完全一致：仍然是不带 `allow-same-origin` 的独立不透明源。
- 静态模式会丢掉页面脚本渲染出来的内容（图表、交互组件）——这是「不执行脚本」的代价。同一个 CSP（`default-src 'none'` + `img-src data:` + `style-src 'unsafe-inline'`）也意味着静态预览不加载任何外部资源：相对/远程图片、CSS `url()` 背景、外部字体、以及 `<link rel=stylesheet>` 引用的样式表全部旁路（静态路径不打包 CSS），只剩 `data:` 图片与内联样式生效。它是「纯文本预览」，不是「离线版页面」。
- 交互预览的不透明源连相对引用都解析不了（`blob:` 文档的 base URL 是 opaque path，`new URL('rel.js', document.baseURI)` 直接抛错），所以页面绝不可能读到 GUI 源上的资源；**绝对 URL 的外联（远程图片、脚本、上报）仍然是允许的**——`sandbox="allow-scripts"` 只限制同源读取，不限制对外网络。脚本依赖型页面（`looksScriptRendered`：剥掉脚本与标签后可见文本不足 200 字符）切到静态时会在预览上方说明「内容会显示为空白」，并提供「运行页面脚本」按钮，避免空白被误认为故障。
- CSS `url()` 内的相对图片、ES module、动态 URL 仍不解析（沿用官方范围）；这些引用在 iframe 内解析失败，但不影响其余已内联资源。
- 一次渲染最多 64 次额外 `file-content` RPC；打包失败静默回落到原始字节（页面仍完整可读，只是没有新样式）。
- 官方改 `packHtml` 的收集规则或上限时，`html-pack.ts` 必须跟着改；`test/unit/html-pack.test.mjs` 与 e2e 的 `styled.html` / `unpacked.html` 夹具锁定当前行为。
