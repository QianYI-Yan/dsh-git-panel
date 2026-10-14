/**
 * Virtual-list window math: prefix-sum offsets + viewport windowing over a
 * list of fixed-height-per-kind rows (change list group heads + file rows).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTops, lowerBound, windowRange, findWindowRange } from '../../lib/testkit.mjs'

test('buildTops is an ascending prefix sum with a trailing total', () => {
  assert.deepEqual(buildTops([26, 28, 28, 26, 28]), [0, 26, 54, 82, 108, 136])
  assert.deepEqual(buildTops([]), [0])
  assert.deepEqual(buildTops([28]), [0, 28])
})

test('lowerBound returns the largest index whose offset is <= y', () => {
  const tops = [0, 26, 54, 82, 108, 136]
  assert.equal(lowerBound(tops, 0), 0)
  assert.equal(lowerBound(tops, 25), 0)
  assert.equal(lowerBound(tops, 26), 1)
  assert.equal(lowerBound(tops, 100), 3)
  assert.equal(lowerBound(tops, 136), 5)
  assert.equal(lowerBound(tops, 999), 5, 'clamped to the last index')
  assert.equal(lowerBound(tops, -10), 0, 'clamped to the first index')
})

test('windowRange covers only the viewport plus overscan', () => {
  // 100 rows of height 10 → tops 0,10,…,1000.
  const tops = buildTops(new Array(100).fill(10))
  // Viewport [200,400], no overscan: rows 20..40 overlap (last exclusive).
  const w = windowRange(tops, 200, 200, 0)
  assert.equal(w.first, 20)
  assert.equal(w.last, 41)
  assert.ok(w.last - w.first < 100, 'far fewer than all 100 rows mount')
})

test('windowRange pads by the overscan margin and clamps to the ends', () => {
  const tops = buildTops(new Array(100).fill(10))
  // Near the top with 30px overscan: first clamps to 0.
  const top = windowRange(tops, 10, 100, 30)
  assert.equal(top.first, 0)
  // Near the bottom: last clamps to the row count (100), never beyond.
  const bottom = windowRange(tops, 900, 100, 30)
  assert.equal(bottom.last, 100)
  assert.ok(bottom.first > 80)
})

test('windowRange on an empty list is an empty range', () => {
  assert.deepEqual(windowRange(buildTops([]), 0, 600, 100), { first: 0, last: 0 })
})

test('windowRange handles mixed row heights (heads taller than rows)', () => {
  // head(26) + 3 rows(28) + head(26) + 2 rows(28): tops accumulate per kind.
  const tops = buildTops([26, 28, 28, 28, 26, 28, 28])
  assert.deepEqual(tops, [0, 26, 54, 82, 110, 136, 164, 192])
  // A viewport starting at 60 (inside the 3rd item) through 140.
  const w = windowRange(tops, 60, 80, 0)
  assert.equal(w.first, 2, 'item 2 starts at 54 <= 60')
  assert.equal(w.last, 6, 'item 5 starts at 136 <= 140, item 6 at 164 excluded')
})

test('findWindowRange snaps onto a far match instead of spanning the gap', () => {
  const range = { first: 0, last: 40 }
  // Inside the window: extend by the overscan margin only, keep the far edge.
  assert.deepEqual(findWindowRange(range, 20, 600, 12), { first: 0, last: 40 })
  // Far below: SNAP onto the match's neighbourhood. Mounting the span from the
  // viewport to the match in one commit is the whole-file freeze virtualization
  // exists to remove.
  const below = findWindowRange(range, 540, 600, 12)
  assert.deepEqual(below, { first: 528, last: 552 })
  assert.ok(below.last - below.first <= 24, 'only the neighbourhood mounts')
  // Far above: same, snapped upward and clamped at 0.
  assert.deepEqual(findWindowRange({ first: 500, last: 540 }, 3, 600, 12), { first: 0, last: 15 })
  // Clamped to the row count at the tail.
  assert.deepEqual(findWindowRange(range, 599, 600, 12), { first: 587, last: 600 })
  // No active match leaves the window untouched.
  assert.deepEqual(findWindowRange(range, -1, 600, 12), range)
})

test('findWindowRange treats the window as half-open [first, last)', () => {
  const range = { first: 100, last: 140 }
  // activeRow === last is outside → snap (the last mounted row is last - 1).
  assert.deepEqual(findWindowRange(range, 140, 600, 12), { first: 128, last: 152 })
  assert.deepEqual(findWindowRange(range, 99, 600, 12), { first: 87, last: 111 })
  // The last row actually inside keeps the viewport's own window.
  assert.deepEqual(findWindowRange(range, 139, 600, 12), { first: 100, last: 151 })
})
