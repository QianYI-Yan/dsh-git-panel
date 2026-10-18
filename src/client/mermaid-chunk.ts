/**
 * Lazy mermaid chunk: the only place mermaid exists in the shipped tree. The
 * main client bundle loads it through `require.async('./client.mermaid.js')`
 * the first time a rendered document actually contains a mermaid fence, so
 * the panel's steady-state download stays mermaid-free.
 *
 * Entry choice: `import mermaid from 'mermaid'` resolves to `mermaid.core.mjs`
 * (typed ESM). Its per-diagram lazy `import("./chunks/…")` calls are
 * string-literal relative imports, which esbuild inlines when bundling to
 * CommonJS — one self-contained file, the only shape the plugin route's
 * one-file chunk model can serve. The prebuilt `dist/mermaid.min.js` is NOT
 * usable here: it assigns `globalThis.__esbuild_esm_mermaid_nm` from a
 * top-level `var`, which stops reaching globalThis once the chunk runs inside
 * the ModuleLoader factory closure (it threw `TypeError` on load).
 * `securityLevel: 'strict'` keeps diagram sources from carrying scripts or
 * click handlers into the SVG.
 */
import mermaid from 'mermaid'

let sequence = 0

/** Render one mermaid source to SVG markup under the given built-in theme. */
export async function renderMermaid(source: string, theme: 'default' | 'dark'): Promise<string> {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme,
    // Deterministic element ids keep repeated renders of the same source from
    // colliding inside one document and make the SVG deterministic.
    deterministicIds: true,
  })
  const { svg } = await mermaid.render(`gp-mermaid-${String(++sequence)}`, source)
  return svg
}
