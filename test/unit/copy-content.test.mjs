/**
 * canCopyContent: eligibility of the file browser's "copy file content"
 * button. Locks the three product rules — text documents only (binary, image,
 * over-cap, error, and loading previews excluded), strictly under the shared
 * 10 MiB copy envelope, with the stat size preferred and the loaded body's
 * UTF-8 length as the fallback.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canCopyContent } from '../../lib/testkit.mjs'
import { FILE_COPY_MAX_BYTES } from '../../lib/host/types.js'

test('copy content applies only to a loaded text preview', () => {
  assert.equal(canCopyContent({ kind: 'text', size: 24, content: 'const x = 1\n' }), true)
  assert.equal(canCopyContent({ kind: 'binary', size: 5 }), false, 'binary bodies never copy')
  assert.equal(canCopyContent({ kind: 'image', size: 64 }), false, 'a content-less image never copies')
  assert.equal(canCopyContent({ kind: 'image', size: 120, content: '<svg/>\n' }), true, 'an SVG copies its markup')
  // Reachable only when the profile cap is set above the envelope; the host
  // then serves the picture and the envelope still decides the clipboard.
  assert.equal(canCopyContent({ kind: 'image', size: FILE_COPY_MAX_BYTES, content: '<svg/>' }), false, 'the envelope still gates an SVG')
  assert.equal(canCopyContent({ kind: 'tooLarge', size: FILE_COPY_MAX_BYTES + 1 }), false, 'unreadable bodies never copy')
  assert.equal(canCopyContent({ kind: 'error' }), false)
  assert.equal(canCopyContent({ kind: 'loading' }), false)
  assert.equal(canCopyContent({ kind: 'idle' }), false)
})

test('copy content enforces the envelope strictly below 10 MiB', () => {
  assert.equal(canCopyContent({ kind: 'text', size: FILE_COPY_MAX_BYTES - 1, content: 'x' }), true)
  // An SVG past the image cap arrives as a text preview, so 4–10 MiB of markup
  // stays copyable — the point of serving it as source instead of tooLarge.
  assert.equal(canCopyContent({ kind: 'text', size: FILE_COPY_MAX_BYTES - 1, content: '<svg/>' }), true, 'an over-cap SVG served as source is copyable')
  assert.equal(canCopyContent({ kind: 'text', size: FILE_COPY_MAX_BYTES, content: 'x' }), false, 'the envelope itself is not copyable')
  assert.equal(canCopyContent({ kind: 'text', size: FILE_COPY_MAX_BYTES + 1, content: 'x' }), false)
})

test('copy content falls back to the body byte length without a stat size', () => {
  assert.equal(canCopyContent({ kind: 'text', content: 'const x = 1\n' }), true)
  assert.equal(canCopyContent({ kind: 'text', content: undefined }), true, 'an empty body is still a text file')
  assert.equal(canCopyContent({ kind: 'text', content: 'a'.repeat(FILE_COPY_MAX_BYTES) }), false, 'an oversized body stays out of the clipboard')
  // Byte vs character counting: '€' is 3 UTF-8 bytes, so half an envelope of
  // characters is under the limit as characters but over it as bytes — a
  // char-counting regression would wrongly report true here.
  assert.equal(canCopyContent({ kind: 'text', content: '€'.repeat(FILE_COPY_MAX_BYTES / 2) }), false, 'multibyte bodies count UTF-8 bytes, not characters')
  assert.equal(canCopyContent({ kind: 'text', content: '€'.repeat(1000) }), true, 'a small multibyte body still copies')
})
