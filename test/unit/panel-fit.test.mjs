/**
 * isCramped: the combined width+height gate for height-saving UI.
 *
 * The panel trades content away (the commit editor folds, the change timestamps
 * are dropped) only when both axes are scarce. Width alone decides the layout
 * mode; height alone never triggers anything. These cases pin that separation —
 * a squeezed desktop column and a large phone must keep the full UI, which is
 * the whole point of judging both dimensions together.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isCramped, COMPACT_BP, SHORT_BP } from '../../lib/testkit.mjs'

const layout = (compact, short) => ({ compact, short })

test('cramped only when the panel is narrow and short at the same time', () => {
  assert.equal(isCramped(layout(true, true)), true)
  assert.equal(isCramped(layout(true, false)), false, 'narrow but tall keeps the full UI')
  assert.equal(isCramped(layout(false, true)), false, 'short but wide keeps the full UI')
  assert.equal(isCramped(layout(false, false)), false)
})

test('a desktop column squeezed by a sidebar is narrow yet tall: not cramped', () => {
  // 400px wide (compact) in a 900px-tall panel: the case this rule exists for.
  assert.equal(isCramped(layout(400 <= COMPACT_BP, 900 <= SHORT_BP)), false)
})

test('a landscape phone window is narrow and short: cramped', () => {
  // 390px wide, 420px tall panel: genuinely no room, so the fold is correct.
  assert.equal(isCramped(layout(390 <= COMPACT_BP, 420 <= SHORT_BP)), true)
})

test('a portrait phone panel is narrow but tall enough to keep the editor', () => {
  // 390x690 panel: the change list can afford the editor and the timestamps.
  assert.equal(isCramped(layout(390 <= COMPACT_BP, 690 <= SHORT_BP)), false)
})

test('a wide desktop panel is never cramped, however short', () => {
  assert.equal(isCramped(layout(1200 <= COMPACT_BP, 300 <= SHORT_BP)), false, 'the wide layout has its own structure')
})

test('the breakpoints keep the documented relationship', () => {
  // Both are container measures and both are positive; the exact values are a
  // product decision, so only their ordering contract is pinned here.
  assert.ok(COMPACT_BP > 0 && SHORT_BP > 0)
  assert.equal(COMPACT_BP, 620)
  assert.equal(SHORT_BP, 520)
})
