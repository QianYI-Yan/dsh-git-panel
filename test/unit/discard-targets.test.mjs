/**
 * Batch-discard target resolution: selection keys carry the side they were
 * picked on (`path:w` working tree / `path:s` index), and only the working-tree
 * side can be discarded — staged-only picks are reported separately.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickDiscardTargets } from '../../lib/testkit.mjs'

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
