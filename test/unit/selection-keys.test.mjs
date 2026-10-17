/**
 * Change-list selection keys: the single codec for `path:s` (index side) /
 * `path:w` (working tree). Locks the codec against the two inline spellings it
 * replaced (a `replace(/:[sw]$/, '')` strip and an `endsWith` side probe) plus
 * the batch-discard resolution built on top of it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { changeKey, sideOf, pathOfKey, pickDiscardTargets } from '../../lib/testkit.mjs'

// The two spellings that used to live at the call sites. Keys that reach either
// one are always built by `changeKey`, so the codec only has to agree with them
// on that shape — including the awkward ones below, where a path itself ends in
// a side-looking segment.
const LEGACY_STRIP = (k) => k.replace(/:[sw]$/, '')
const LEGACY_SIDE = (k) => (k.endsWith(':w') ? 'w' : k.endsWith(':s') ? 's' : null)
const KEYS = [
  'a.txt:w', 'a.txt:s', 'dup.txt:s', 'dup.txt:w', 'newdir:w',
  'x:w:w', 'x:s:w', 'a::w', 'dir/w:q:w', 'nested/x:s:w',
  'a:b.txt:w', 'a:b.txt:s', 'dir with space/f.txt:w', 'f.txt:s',
  'bare.txt', 'odd:x', 's', 'w', ':w', ':s', 'a.txt:q', 'a.txt:w:w',
]

test('changeKey builds the legacy path+side spelling', () => {
  const changes = [
    { path: 'a.txt', staged: true }, { path: 'a.txt', staged: false },
    { path: 'dir/b.txt', staged: true }, { path: 'x:w', staged: false },
  ]
  for (const c of changes) {
    assert.equal(changeKey(c), c.path + (c.staged ? ':s' : ':w'))
  }
})

test('pathOfKey is equivalent to the legacy strip on every key shape', () => {
  for (const k of KEYS) assert.equal(pathOfKey(k), LEGACY_STRIP(k), `pathOfKey(${k})`)
})

test('sideOf is equivalent to the legacy endsWith probe on every key shape', () => {
  for (const k of KEYS) assert.equal(sideOf(k), LEGACY_SIDE(k), `sideOf(${k})`)
})

test('changeKey round-trips through pathOfKey and sideOf', () => {
  for (const staged of [true, false]) {
    for (const path of ['a.txt', 'dir/w:q', 'nested/x:s', 'a:b.txt', 'x:w']) {
      const key = changeKey({ path, staged })
      assert.equal(pathOfKey(key), path)
      assert.equal(sideOf(key), staged ? 's' : 'w')
    }
  }
})

test('pathOfKey only strips the trailing side suffix', () => {
  assert.equal(pathOfKey('x:w:w'), 'x:w')
  assert.equal(pathOfKey('a::w'), 'a:')
  assert.equal(pathOfKey('dir/w:q:w'), 'dir/w:q')
  assert.equal(pathOfKey('nested/x:s:w'), 'nested/x:s')
  assert.equal(pathOfKey('a.txt'), 'a.txt')
})

test('pickDiscardTargets keeps working-tree paths, sorted', () => {
  assert.deepEqual(pickDiscardTargets(['b.txt:w', 'a.txt:w']), { paths: ['a.txt', 'b.txt'], stagedOnly: [] })
})

test('pickDiscardTargets dedupes a path picked on both sides', () => {
  assert.deepEqual(pickDiscardTargets(['a.txt:w', 'a.txt:s']), { paths: ['a.txt'], stagedOnly: [] })
})

test('pickDiscardTargets reports staged-only picks apart from the discard set', () => {
  assert.deepEqual(
    pickDiscardTargets(['c.txt:s', 'b.txt:w', 'a.txt:s']),
    { paths: ['b.txt'], stagedOnly: ['a.txt', 'c.txt'] },
  )
})

test('pickDiscardTargets is empty for an empty selection', () => {
  assert.deepEqual(pickDiscardTargets([]), { paths: [], stagedOnly: [] })
})

test('pickDiscardTargets ignores keys with no known side', () => {
  assert.deepEqual(pickDiscardTargets(['bare.txt', 'odd:x']), { paths: [], stagedOnly: [] })
})

test('pickDiscardTargets only strips the trailing side suffix', () => {
  assert.deepEqual(pickDiscardTargets(['a:b.txt:w']), { paths: ['a:b.txt'], stagedOnly: [] })
})
