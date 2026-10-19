/**
 * HTML preview asset packing — the panel-side mirror of the official
 * document preview's `packHtml` (see ADR-0020). A `srcdoc` iframe has no URL
 * of its own, so authored relative `css`/`js` references would resolve
 * against the GUI origin and 404. Packing reads those references through the
 * host's validated `file-content` route and hands the iframe a bootstrap
 * document that turns each asset into an in-document blob URL before
 * `document.write`ing the page — same opaque-origin sandbox, styles load.
 *
 * All-or-nothing like the official pack: any limit trip, missing asset, or
 * unsafe reference gives the whole pack up (`null`) and the caller renders
 * the plain page bytes, which is exactly the previous behaviour. A `<base
 * href>` hands URL resolution to the browser, so packing is skipped.
 */
/** One static dependency of a previewed HTML document. */
export interface AssetRef {
  readonly kind: 'script' | 'stylesheet'
  /** Authored `src`/`href` value, verbatim — the bootstrap matches on it. */
  readonly reference: string
}

/** A packed asset: the authored reference plus its decoded text. */
export interface HtmlAsset extends AssetRef {
  readonly text: string
}

/** Per-asset, whole-package and asset-count caps, mirroring the official pack. */
export const MAX_ASSET_BYTES = 4 * 1024 * 1024
export const MAX_TOTAL_BYTES = 32 * 1024 * 1024
export const MAX_ASSETS = 64

/**
 * Whether this reference can be read relative to the original document,
 * never the parent application URL: non-empty, no scheme, not absolute, not
 * a fragment/query-only reference, no NUL.
 */
export function isRelativeAssetReference(reference: string): boolean {
  return reference.length > 0 && !/^(?:[a-z][a-z\d+.-]*:|[/\\#?])/i.test(reference) && !reference.includes('\0')
}

/**
 * Resolve one authored reference to a browse-root-relative path beside the
 * document. Strips query/fragment (not filename components), decodes percent
 * escapes exactly once, and resolves `.`/`..` segments; a reference that
 * escapes the root or uses a scheme/absolute/backslash spelling is refused —
 * the host's `isSafePath` re-validates whatever crosses the wire.
 *
 * @param documentPath Browse-root-relative path of the previewed HTML file.
 * @param reference Authored `src`/`href` value.
 * @returns Root-relative path, or undefined when the reference is unusable.
 */
export function resolveAssetPath(documentPath: string, reference: string): string | undefined {
  const suffix = reference.search(/[?#]/)
  let path: string
  try {
    path = decodeURIComponent(suffix === -1 ? reference : reference.slice(0, suffix))
  } catch {
    return undefined
  }
  if (path.length === 0 || path.includes('\0') || path.includes('\\')) return undefined
  if (/^(?:[a-z][a-z\d+.-]*:|[/\\])/i.test(path)) return undefined
  const slash = documentPath.lastIndexOf('/')
  const dir = slash < 0 ? '' : documentPath.slice(0, slash + 1)
  const out: string[] = []
  for (const segment of (dir + path).split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (out.length === 0) return undefined
      out.pop()
      continue
    }
    out.push(segment)
  }
  return out.join('/')
}

/**
 * Read every collected reference through `readText` and enforce the pack
 * limits. Sequential and all-or-nothing, mirroring the official loop: the
 * first unusable reference, failed read, or limit trip gives up the pack.
 *
 * @param refs References collected from the document (already filtered and deduped).
 * @param documentPath Browse-root-relative path of the previewed HTML file.
 * @param readText Reads one root-relative file as text; null on any failure.
 * @param htmlBytes Size budget already spent by the page itself.
 * @returns The asset set, or null when the pack must be abandoned.
 */
export async function packAssets(
  refs: readonly AssetRef[],
  documentPath: string,
  readText: (path: string) => Promise<string | null>,
  htmlBytes: number,
): Promise<HtmlAsset[] | null> {
  if (refs.length > MAX_ASSETS) return null
  let total = htmlBytes
  const assets: HtmlAsset[] = []
  for (const ref of refs) {
    const path = resolveAssetPath(documentPath, ref.reference)
    if (path === undefined) return null
    const text = await readText(path)
    if (text === null) return null
    const size = new TextEncoder().encode(text).byteLength
    if (size > MAX_ASSET_BYTES) return null
    total += size
    if (total > MAX_TOTAL_BYTES) return null
    assets.push({ kind: ref.kind, reference: ref.reference, text })
  }
  return assets
}

/**
 * Encode Unicode text for the iframe's base64 payload: UTF-8 bytes as a
 * binary string in bounded chunks (a spread over a multi-megabyte array
 * would overflow the argument limit).
 */
export function encodeText(text: string): string {
  const bytes = new TextEncoder().encode(text)
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)))
  }
  return btoa(chunks.join(''))
}

/**
 * Build the bootstrap document handed to `srcdoc`: a fixed script decodes
 * the embedded bundle, mints one blob URL per asset **inside the iframe**
 * (a unique opaque origin cannot load blob URLs created by the parent),
 * rewrites the matching `link`/`script` attributes, and `document.write`s
 * the page. Asset text reaches the iframe only as base64 JSON, so page
 * bytes can never break out of the bootstrap script.
 *
 * @param html Complete page text.
 * @param assets Packed asset set (never empty — an empty set means the
 * caller should render the plain page instead).
 */
export function createHtmlDocument(html: string, assets: readonly HtmlAsset[]): string {
  const bundle = encodeText(JSON.stringify({ html, assets: assets.map((asset) => ({ kind: asset.kind, reference: asset.reference, text: asset.text })) }))
  return `<!doctype html><meta charset="utf-8"><script>(()=>{ const bytes=data=>Uint8Array.from(atob(data),character=>character.charCodeAt(0)); const text=data=>new TextDecoder('utf-8',{fatal:true}).decode(bytes(data)); const bundle=JSON.parse(text("${bundle}")); const parsed=new DOMParser().parseFromString(bundle.html,'text/html'); for(const asset of bundle.assets){ const script=asset.kind==='script'; const url=URL.createObjectURL(new Blob([asset.text],{type:script?'application/javascript':'text/css'})); const attribute=script?'src':'href'; for(const element of parsed.querySelectorAll(script?'script[src]':'link[rel~="stylesheet" i][href]')){ if(element.getAttribute(attribute)===asset.reference)element.setAttribute(attribute,url); } } document.open();document.write('<!doctype html>'+parsed.documentElement.outerHTML);document.close(); })()</script>`
}

/**
 * Read the page's packable references and, when there are any, replace the
 * plain `srcdoc` body with {@link createHtmlDocument}'s bootstrap.
 *
 * @param html Complete page text (already decoded by the host).
 * @param documentPath Browse-root-relative path of the previewed HTML file.
 * @param readText Reads one root-relative file as text; null on any failure.
 * @returns The bootstrap document, or null for "render the plain bytes":
 * no packable references, a `<base href>`, or any pack failure.
 */
export async function packHtmlDocument(
  html: string,
  documentPath: string,
  readText: (path: string) => Promise<string | null>,
): Promise<string | null> {
  const collected = collectHtmlAssets(html)
  if (collected === 'skip' || collected.length === 0) return null
  const htmlBytes = new TextEncoder().encode(html).byteLength
  const assets = await packAssets(collected, documentPath, readText, htmlBytes)
  if (assets === null || assets.length === 0) return null
  return createHtmlDocument(html, assets)
}

/**
 * Collect the document's packable static references without executing or
 * mounting anything in the parent page (a inert `<template>` never runs
 * scripts or fetches). A `<base href>` leaves URL resolution to the browser,
 * so packing is skipped; over the asset-count limit the pack is abandoned.
 * Only direct classic `.js` scripts and `.css` stylesheet links are packed —
 * modules, `url()`/`@import` inside CSS and dynamically built URLs are
 * unsupported, exactly like the official pack.
 *
 * @param html Complete page text.
 * @returns Collected refs, or 'skip' when packing must not run at all.
 */
export function collectHtmlAssets(html: string): AssetRef[] | 'skip' {
  if (typeof document === 'undefined') return 'skip'
  const template = document.createElement('template')
  template.innerHTML = html
  if (template.content.querySelector('base[href]') !== null) return 'skip'
  const refs: AssetRef[] = []
  const seen = new Set<string>()
  for (const element of template.content.querySelectorAll('script[src],link[href]')) {
    const script = element.localName === 'script'
    const type = element.getAttribute('type')?.trim().toLowerCase() ?? ''
    if (script && !['', 'text/javascript', 'application/javascript'].includes(type)) continue
    if (!script && !(element.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).includes('stylesheet')) continue
    const reference = element.getAttribute(script ? 'src' : 'href') ?? ''
    const suffix = reference.search(/[?#]/)
    const path = suffix === -1 ? reference : reference.slice(0, suffix)
    if (!isRelativeAssetReference(reference) || !(script ? /\.js$/i : /\.css$/i).test(path)) continue
    const key = `${script ? 'script' : 'stylesheet'}:${reference}`
    if (seen.has(key)) continue
    seen.add(key)
    if (refs.length >= MAX_ASSETS) return 'skip'
    refs.push({ kind: script ? 'script' : 'stylesheet', reference })
  }
  return refs
}
