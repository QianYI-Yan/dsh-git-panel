/**
 * html-pack: the HTML preview asset packer that mirrors the official
 * document preview's packHtml. Locks the reference filter (relative only,
 * scheme/absolute/NUL refused), the document-relative path resolution
 * (query/fragment stripped, one decode, `.`/`..` resolved, root escape
 * refused), the all-or-nothing pack loop with its byte/count caps, and the
 * bootstrap document that carries page + assets as base64 JSON for the
 * iframe to rewrite to blob URLs.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isRelativeAssetReference, resolveAssetPath, packAssets, encodeText, createHtmlDocument,
  packHtmlDocument, MAX_ASSET_BYTES, MAX_TOTAL_BYTES, MAX_ASSETS,
} from '../../lib/testkit.mjs'

const DOC = 'docs/local/mock.html'

test('relative asset references pass; schemes, absolutes and fragments do not', () => {
  for (const ref of ['style.css', './a.js', '../x/y.css', 'deep/dir/z.css?v=2#frag']) {
    assert.equal(isRelativeAssetReference(ref), true, ref)
  }
  for (const ref of ['', '/abs.css', '\\abs.css', '#only-fragment', '?only-query', 'https://cdn/x.css', 'data:text/css,body{}', 'file:///etc/x.css']) {
    assert.equal(isRelativeAssetReference(ref), false, ref)
  }
  assert.equal(isRelativeAssetReference(`ava${String.fromCharCode(0)}l.css`), false, 'NUL byte')
})

test('references resolve beside the document with one decode round-trip', () => {
  assert.equal(resolveAssetPath(DOC, 'style.css'), 'docs/local/style.css')
  assert.equal(resolveAssetPath(DOC, './sub/a.js'), 'docs/local/sub/a.js')
  assert.equal(resolveAssetPath(DOC, '../assets/x.css'), 'docs/assets/x.css')
  assert.equal(resolveAssetPath(DOC, 'a/../../b.css'), 'docs/b.css')
  assert.equal(resolveAssetPath('mock.html', 'style.css'), 'style.css', 'a root-level document resolves at the root')
})

test('query and fragment suffixes are not filename components', () => {
  assert.equal(resolveAssetPath(DOC, 'style.css?v=2#frag'), 'docs/local/style.css')
})

test('percent escapes decode exactly once', () => {
  assert.equal(resolveAssetPath(DOC, 'my%20style.css'), 'docs/local/my style.css')
})

test('unusable references are refused', () => {
  assert.equal(resolveAssetPath(DOC, '../../../escape.css'), undefined, 'root escape')
  assert.equal(resolveAssetPath(DOC, 'https://cdn/x.css'), undefined, 'scheme')
  assert.equal(resolveAssetPath(DOC, '/abs.css'), undefined, 'absolute')
  assert.equal(resolveAssetPath(DOC, 'a\\b.css'), undefined, 'backslash')
  assert.equal(resolveAssetPath(DOC, '%zz.css'), undefined, 'broken percent escape')
  assert.equal(resolveAssetPath(DOC, ''), undefined, 'empty')
})

const readOf = (files) => async (path) => (Object.hasOwn(files, path) ? files[path] : null)

test('packAssets reads each reference beside the document', async () => {
  const assets = await packAssets(
    [{ kind: 'stylesheet', reference: 'style.css' }, { kind: 'script', reference: './a.js' }],
    DOC,
    readOf({ 'docs/local/style.css': 'body{color:red}', 'docs/local/a.js': 'window.x=1' }),
    0,
  )
  assert.deepEqual(assets, [
    { kind: 'stylesheet', reference: 'style.css', text: 'body{color:red}' },
    { kind: 'script', reference: './a.js', text: 'window.x=1' },
  ])
})

test('packAssets is all-or-nothing: a missing read abandons the whole pack', async () => {
  const assets = await packAssets(
    [{ kind: 'stylesheet', reference: 'style.css' }, { kind: 'stylesheet', reference: 'missing.css' }],
    DOC,
    readOf({ 'docs/local/style.css': 'body{}' }),
    0,
  )
  assert.equal(assets, null)
})

test('packAssets enforces the per-asset, total and count caps', async () => {
  const big = 'x'.repeat(MAX_ASSET_BYTES + 1)
  assert.equal(
    await packAssets([{ kind: 'stylesheet', reference: 'big.css' }], DOC, readOf({ 'docs/local/big.css': big }), 0),
    null, 'per-asset cap',
  )
  assert.equal(
    await packAssets([{ kind: 'stylesheet', reference: 'a.css' }], DOC, readOf({ 'docs/local/a.css': 'x'.repeat(100) }), MAX_TOTAL_BYTES),
    null, 'total cap includes the page bytes already spent',
  )
  const many = Array.from({ length: MAX_ASSETS + 1 }, (_, i) => ({ kind: 'stylesheet', reference: `a${i}.css` }))
  assert.equal(await packAssets(many, DOC, readOf({}), 0), null, 'count cap')
})

test('encodeText is base64 of the UTF-8 bytes', () => {
  assert.equal(Buffer.from(encodeText('hello'), 'base64').toString('utf8'), 'hello')
  assert.equal(Buffer.from(encodeText('颜色 emoji 🎨'), 'base64').toString('utf8'), '颜色 emoji 🎨')
})

test('createHtmlDocument carries the page and assets as base64 JSON for the bootstrap', () => {
  const doc = createHtmlDocument('<p>hi</p>', [{ kind: 'stylesheet', reference: 'style.css', text: 'body{}' }])
  assert.ok(doc.startsWith('<!doctype html><meta charset="utf-8"><script>'), 'bootstrap shell first')
  assert.ok(doc.includes('createObjectURL') && doc.includes('document.write'), 'rewrite + write bootstrap')
  const payload = doc.match(/JSON\.parse\(text\("([^"]+)"\)\)/)
  assert.ok(payload, 'base64 payload embedded')
  const bundle = JSON.parse(Buffer.from(payload[1], 'base64').toString('utf8'))
  assert.deepEqual(bundle, { html: '<p>hi</p>', assets: [{ kind: 'stylesheet', reference: 'style.css', text: 'body{}' }] })
})

test('packHtmlDocument returns null in a non-DOM runtime (no packable parse)', async () => {
  assert.equal(await packHtmlDocument('<link rel="stylesheet" href="a.css">', DOC, readOf({})), null)
})
