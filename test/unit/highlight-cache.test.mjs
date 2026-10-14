/**
 * Highlight-cache tests: the diff view re-renders rows constantly (window moves,
 * ancestor renders), so the same line must never be tokenized twice.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { memoizeHighlighter, HL_CACHE_MAX } from '../../lib/testkit.mjs'

/** A stand-in highlighter that counts calls and echoes the fragment. */
function counting() {
  const calls = []
  const hl = (code) => { calls.push(code); return [[{ text: code, style: {} }]] }
  return { hl, calls }
}

test('memoizeHighlighter tokenizes each distinct fragment once', () => {
  const { hl, calls } = counting()
  const cached = memoizeHighlighter(hl)
  assert.equal(cached('const a = 1'), cached('const a = 1'))
  cached('const a = 1')
  cached('const b = 2')
  cached('const a = 1')
  assert.deepEqual(calls, ['const a = 1', 'const b = 2'])
})

test('memoizeHighlighter caches an undefined result (grammar not loaded yet)', () => {
  let n = 0
  const cached = memoizeHighlighter(() => { n++; return undefined })
  assert.equal(cached('x'), undefined)
  assert.equal(cached('x'), undefined)
  assert.equal(n, 1)
})

test('memoizeHighlighter passes the exact value through', () => {
  const spans = [[{ text: 'a', style: { color: 'var(--shiki-keyword)' } }]]
  const cached = memoizeHighlighter(() => spans)
  assert.equal(cached('a'), spans)
})

test('memoizeHighlighter drops the cache at the cap instead of growing without bound', () => {
  const { hl, calls } = counting()
  const cached = memoizeHighlighter(hl)
  for (let i = 0; i < HL_CACHE_MAX; i++) cached(`line ${i}`)
  assert.equal(calls.length, HL_CACHE_MAX)
  // Still a hit at exactly the cap: nothing is evicted until a new fragment
  // arrives.
  cached('line 0')
  assert.equal(calls.length, HL_CACHE_MAX, 'a hit at the cap does not re-tokenize')
  // One past the cap clears the cache, so previously cached fragments are
  // tokenized again rather than the map growing without bound.
  cached('one more')
  assert.equal(calls.length, HL_CACHE_MAX + 1)
  cached('line 0')
  assert.equal(calls.length, HL_CACHE_MAX + 2, 'the dropped fragment is tokenized again')
})

test('each memoized highlighter has its own cache (a language switch starts fresh)', () => {
  const first = counting()
  const second = counting()
  const a = memoizeHighlighter(first.hl)
  const b = memoizeHighlighter(second.hl)
  a('x')
  a('x')
  b('x')
  assert.equal(first.calls.length, 1)
  assert.equal(second.calls.length, 1)
})
