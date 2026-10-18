/**
 * markdownImageUrl: the rendered-Markdown image resolver that maps authored
 * destinations onto the platform's authenticated `api/file` route. Locks the
 * official parsing contract one-for-one — relative destinations join beside
 * the document, schemes and UNC never reach the route, query/fragment suffixes
 * are not filename components, and a single decode round-trips percent escapes.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { markdownImageUrl, createPathImages } from '../../lib/testkit.mjs'

const BASE = 'http://127.0.0.1:3080/'
const DOC = '/Users/dev/repo/README.md'

test('relative destinations resolve beside the document', () => {
  assert.equal(
    markdownImageUrl(BASE, DOC, 'docs/assets/banner-zh.png'),
    'http://127.0.0.1:3080/api/file?path=%2FUsers%2Fdev%2Frepo%2Fdocs%2Fassets%2Fbanner-zh.png',
  )
  assert.equal(
    markdownImageUrl(BASE, '/Users/dev/repo/docs/guide/setup.md', 'assets/x.png'),
    'http://127.0.0.1:3080/api/file?path=%2FUsers%2Fdev%2Frepo%2Fdocs%2Fguide%2Fassets%2Fx.png',
  )
})

test('absolute destinations pass through unchanged', () => {
  assert.equal(
    markdownImageUrl(BASE, DOC, '/var/www/logo.png'),
    'http://127.0.0.1:3080/api/file?path=%2Fvar%2Fwww%2Flogo.png',
  )
  assert.equal(
    markdownImageUrl(BASE, undefined, '/var/www/logo.png'),
    'http://127.0.0.1:3080/api/file?path=%2Fvar%2Fwww%2Flogo.png',
    'an absolute destination needs no document path',
  )
})

test('query and fragment suffixes are not filename components', () => {
  assert.equal(
    markdownImageUrl(BASE, DOC, 'img.png?raw=1#preview'),
    'http://127.0.0.1:3080/api/file?path=%2FUsers%2Fdev%2Frepo%2Fimg.png',
  )
})

test('percent escapes decode once before addressing', () => {
  assert.equal(
    markdownImageUrl(BASE, DOC, 'my%20img.png'),
    'http://127.0.0.1:3080/api/file?path=%2FUsers%2Fdev%2Frepo%2Fmy%20img.png',
  )
})

test('schemes never resolve to the file route', () => {
  for (const destination of [
    'https://example.com/x.png',
    'http://example.com/x.png',
    'data:image/png;base64,AAAA',
    'file:///etc/passwd',
    'mailto:x@example.com',
  ]) {
    assert.equal(markdownImageUrl(BASE, DOC, destination), undefined, destination)
  }
})

test('relative destinations need a document path', () => {
  assert.equal(markdownImageUrl(BASE, undefined, 'img.png'), undefined)
})

test('malformed and empty destinations are rejected', () => {
  assert.equal(markdownImageUrl(BASE, DOC, ''), undefined)
  assert.equal(markdownImageUrl(BASE, DOC, '%zz.png'), undefined, 'broken percent escape')
  const control = `bad${String.fromCharCode(1)}.png`
  assert.equal(markdownImageUrl(BASE, DOC, control), undefined, 'control bytes never reach the route')
})

test('UNC paths are rejected even though they read as absolute', () => {
  assert.equal(markdownImageUrl(BASE, DOC, '\\\\server\\share\\x.png'), undefined)
})

test('Windows drive paths stay intact through the route', () => {
  assert.equal(
    markdownImageUrl(BASE, 'C:\\repo\\README.md', 'img\\a b.png'),
    'http://127.0.0.1:3080/api/file?path=C%3A%5Crepo%5Cimg%5Ca%20b.png',
  )
})

test('non-http transports and the desktop scheme gate the route', () => {
  assert.equal(markdownImageUrl('file:///tmp/page.html', DOC, 'img.png'), undefined)
  assert.equal(
    markdownImageUrl('dsh-app://app/', DOC, 'img.png'),
    'dsh-app://app/api/file?path=%2FUsers%2Fdev%2Frepo%2Fimg.png',
  )
})

test('createPathImages returns a stable resolver bound to one document', () => {
  const images = createPathImages(BASE, DOC)
  assert.equal(images.resolve('img.png'), 'http://127.0.0.1:3080/api/file?path=%2FUsers%2Fdev%2Frepo%2Fimg.png')
  assert.equal(images.resolve, images.resolve, 'resolver identity is stable for memoization')
})
