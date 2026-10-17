/**
 * Filtered-graph tests: projecting the loaded DAG onto the visible commits —
 * direct links stay solid, links across hidden commits are indirect, and a
 * parent the topology cannot resolve becomes a boundary stub.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { layoutFilteredGraph, layoutGraph, graphWidth } from '../../lib/testkit.mjs'

function commit(hash, parents) {
  return { hash, shortHash: hash.slice(0, 7), subject: hash, author: 'A', dateIso: 'D', parents, refs: [] }
}

function topo(entries) {
  return entries.map(([hash, parents]) => ({ hash, parents }))
}

const STYLES = ['compact', 'parallel']

test('a fully visible window lays out exactly like the unfiltered graph', () => {
  const commits = [commit('m', ['a', 'b']), commit('b', ['a']), commit('a', [])]
  const topology = topo([['m', ['a', 'b']], ['b', ['a']], ['a', []]])
  for (const style of STYLES) {
    const rows = layoutFilteredGraph(commits, topology, style)
    assert.deepEqual(rows, layoutGraph(commits, style), `${style}: same rows as the unfiltered layout`)
    assert.equal(rows.some((r) => r.edges.some((e) => e.indirect === true)), false, `${style}: nothing is dashed`)
    assert.equal(rows.some((r) => r.boundary === true), false, `${style}: nothing dangles`)
  }
})

test('an edge across hidden commits is indirect and holds no lane in between', () => {
  const commits = [commit('d', ['c']), commit('a', [])]
  const topology = topo([['d', ['c']], ['c', ['b']], ['b', ['a']], ['a', []]])
  for (const style of STYLES) {
    const rows = layoutFilteredGraph(commits, topology, style)
    assert.equal(rows.length, 2)
    const out = rows[0].edges.filter((e) => e.kind === 'out')
    assert.equal(out.length, 1, `${style}: one outgoing line`)
    assert.equal(out[0].indirect, true, `${style}: it is dashed`)
    assert.equal(rows[1].edges.filter((e) => e.kind === 'into' && e.indirect === true).length, 1, `${style}: it lands dashed`)
    assert.equal(rows[0].boundary, undefined)
    assert.equal(rows[1].boundary, undefined)
    assert.equal(graphWidth(rows), 1, `${style}: the hidden chain adds no column`)
  }
})

test('a hidden merge projects onto several ancestors', () => {
  const commits = [commit('m', ['h1', 'h2']), commit('x', []), commit('y', [])]
  const topology = topo([['m', ['h1', 'h2']], ['h1', ['x']], ['h2', ['y']], ['x', []], ['y', []]])
  const rows = layoutFilteredGraph(commits, topology, 'compact')
  const m = rows[0]
  assert.equal(m.merge, true)
  assert.equal(m.edges.filter((e) => e.kind === 'out').length, 2, 'both ancestors get a line')
  assert.equal(m.edges.filter((e) => e.kind === 'out').every((e) => e.indirect === true), true)
  assert.equal(graphWidth(rows), 2)
})

test('one raw parent crossing a hidden merge shows several lines without a merge glyph', () => {
  const commits = [commit('s', ['h']), commit('x', []), commit('y', [])]
  const topology = topo([['s', ['h']], ['h', ['x', 'y']], ['x', []], ['y', []]])
  const rows = layoutFilteredGraph(commits, topology, 'compact')
  const s = rows[0]
  assert.equal(s.merge, false, 'merge is a property of the raw parents')
  assert.equal(s.edges.filter((e) => e.kind === 'out').length, 2, 'the displayed fork still shows')
  assert.equal(s.edges.filter((e) => e.kind === 'out').every((e) => e.indirect === true), true)
})

test('a target reached directly and across hidden commits keeps one solid link', () => {
  // h resolves to v, which is also s's own second parent: one link, direct wins.
  const commits = [commit('s', ['h', 'v']), commit('q', []), commit('v', [])]
  const topology = topo([['s', ['h', 'v']], ['h', ['v']], ['v', []], ['q', []]])
  const rows = layoutFilteredGraph(commits, topology, 'compact')
  const out = rows[0].edges.filter((e) => e.kind === 'out')
  assert.equal(out.length, 1, 'the duplicate target collapses to one line')
  assert.equal(out[0].indirect, undefined, 'and the direct link wins')
  assert.equal(rows[0].boundary, undefined)
  // Same result when the direct parent is listed first.
  const commits2 = [commit('s2', ['v', 'h2']), commit('q', []), commit('v', [])]
  const topology2 = topo([['s2', ['v', 'h2']], ['h2', ['v']], ['v', []], ['q', []]])
  const rows2 = layoutFilteredGraph(commits2, topology2, 'compact')
  assert.equal(rows2[0].edges.filter((e) => e.kind === 'out').length, 1)
  assert.equal(rows2[0].edges.filter((e) => e.kind === 'out')[0].indirect, undefined)
})

test('an unknown parent becomes a boundary stub and never widens the graph', () => {
  const commits = [commit('m', ['a', 'zzz']), commit('a', [])]
  const topology = topo([['m', ['a', 'zzz']], ['a', []]])
  const rows = layoutFilteredGraph(commits, topology, 'compact')
  assert.equal(rows[0].boundary, true, 'the missing parent is flagged')
  assert.equal(rows[0].edges.filter((e) => e.kind === 'out').length, 1, 'only the known parent draws')
  assert.equal(graphWidth(rows), 1, 'the stub does not open a lane')
})

test('a hidden chain that ends outside the shown commits is a stub too', () => {
  const commits = [commit('a', ['b'])], topology = topo([['a', ['b']], ['b', ['c']], ['c', []]])
  const rows = layoutFilteredGraph(commits, topology, 'compact')
  assert.equal(rows[0].boundary, true)
  assert.equal(rows[0].edges.length, 0)
  assert.equal(graphWidth(rows), 1)
})

test('a 10k hidden chain resolves without recursion and without holding a lane', () => {
  const chain = [['top', ['h0']]]
  for (let i = 0; i < 9999; i++) chain.push([`h${i}`, [`h${i + 1}`]])
  chain.push(['h9999', ['root']], ['root', []])
  const commits = [commit('top', ['h0']), commit('root', [])]
  const rows = layoutFilteredGraph(commits, topo(chain), 'compact')
  assert.equal(rows.length, 2)
  const out = rows[0].edges.filter((e) => e.kind === 'out')
  assert.equal(out.length, 1)
  assert.equal(out[0].indirect, true)
  assert.equal(rows[1].edges.some((e) => e.kind === 'into' && e.indirect === true), true)
  assert.equal(graphWidth(rows), 1)
})

test('a diamond ladder is resolved per node, not per path', () => {
  // 40 levels of two hidden nodes sharing both parents: a path walk would have
  // 2^40 routes to the root, the memo folds each node once.
  const depth = 40
  const nodes = []
  for (let i = 0; i < depth; i++) {
    nodes.push([`A${i}`, [`A${i + 1}`, `B${i + 1}`]], [`B${i}`, [`A${i + 1}`, `B${i + 1}`]])
  }
  nodes.push([`A${depth}`, ['root']], [`B${depth}`, ['root']], ['root', []])
  const commits = [commit('top', ['A0']), commit('root', [])]
  const rows = layoutFilteredGraph(commits, topo(nodes), 'compact')
  const out = rows[0].edges.filter((e) => e.kind === 'out')
  assert.equal(out.length, 1, 'one nearest visible ancestor')
  assert.equal(out[0].indirect, true)
  assert.equal(graphWidth(rows), 1)
})

test('a hidden ancestor queued through redundant parents is folded once', () => {
  // h queues b, then expands a, which queues b again before its first expansion.
  // Both routes reach the same root and must reuse one memo-budget allocation.
  const commits = [commit('top', ['h']), commit('root', [])]
  for (const style of STYLES) {
    let parentScans = 0
    const sharedParents = ['root']
    sharedParents[Symbol.iterator] = function* () {
      parentScans++
      yield 'root'
    }
    const topology = topo([['h', ['a', 'b']], ['a', ['b']], ['b', sharedParents]])
    const rows = layoutFilteredGraph(commits, topology, style)
    // One fold scans for a shareable resolution, then collects the visible root.
    // Repeating it charges the memo budget again even though b is already known.
    assert.ok(parentScans <= 2, `${style}: shared parent list is folded at most once (${parentScans} scans)`)
    assert.equal(rows[0].boundary, undefined, `${style}: the complete DAG has no boundary`)
    assert.equal(rows[0].edges.filter((e) => e.kind === 'out' && e.indirect === true).length, 1, `${style}: one dashed link reaches root`)
    assert.equal(rows[1].edges.filter((e) => e.kind === 'into' && e.indirect === true).length, 1, `${style}: root receives that link`)
  }
})

test('a mixed solid + indirect fork keeps each line dashed for its whole span', () => {
  // m: first parent v (visible → solid) and second parent h (hidden → x, dashed).
  const commits = [commit('m', ['v', 'h']), commit('q', []), commit('v', []), commit('x', [])]
  const topology = topo([['m', ['v', 'h']], ['h', ['x']], ['q', []], ['v', []], ['x', []]])
  for (const style of STYLES) {
    const rows = layoutFilteredGraph(commits, topology, style)
    const byHash = Object.fromEntries(rows.map((r) => [r.commit.hash, r]))
    const out = byHash.m.edges.filter((e) => e.kind === 'out')
    assert.equal(out.length, 2, `${style}: two outgoing lines`)
    assert.equal(out.filter((e) => e.indirect === true).length, 1, `${style}: exactly one dashed`)
    const dashed = out.find((e) => e.indirect === true)
    // The dashed line stays dashed while it passes the rows in between…
    for (const hash of ['q', 'v']) {
      assert.equal(byHash[hash].edges.some((e) => e.kind === 'pass' && e.indirect === true && e.toLane === dashed.toLane), true, `${style}: ${hash} keeps the dashed lane`)
    }
    // …lands dashed on its target, while the first-parent line stays solid.
    assert.equal(byHash.x.edges.some((e) => e.kind === 'into' && e.indirect === true), true, `${style}: x receives the dashed line`)
    assert.equal(byHash.v.edges.some((e) => e.kind === 'into' && e.indirect === true), false, `${style}: v is reached solid`)
  }
})

test('compact keeps lines of different indirect state apart until the target', () => {
  // a reaches p across hidden h (dashed); c reaches p directly (solid). Compact
  // must not fold c into a's lane early, or the shared trunk could not show both.
  const commits = [commit('a', ['h']), commit('c', ['p']), commit('p', [])]
  const topology = topo([['a', ['h']], ['h', ['p']], ['c', ['p']], ['p', []]])
  for (const style of STYLES) {
    const rows = layoutFilteredGraph(commits, topology, style)
    const byHash = Object.fromEntries(rows.map((r) => [r.commit.hash, r]))
    assert.notEqual(byHash.c.lane, byHash.a.lane, `${style}: c keeps its own column`)
    const into = byHash.p.edges.filter((e) => e.kind === 'into')
    assert.equal(into.length, 2, `${style}: both lines converge at the real target`)
    assert.equal(into.filter((e) => e.indirect === true).length, 1, `${style}: one stays dashed`)
    assert.equal(into.filter((e) => e.indirect !== true).length, 1, `${style}: one stays solid`)
  }
})

test('loading another page recomputes against the new visible set', () => {
  const topology = topo([['a', ['b']], ['b', ['c']], ['c', []]])
  const first = layoutFilteredGraph([commit('a', ['b'])], topology, 'compact')
  assert.equal(first[0].boundary, true, 'b is still hidden: nothing to draw to')
  const second = layoutFilteredGraph([commit('a', ['b']), commit('b', ['c'])], topology, 'compact')
  assert.equal(second[0].boundary, undefined, 'b is visible now: a solid link')
  assert.equal(second[0].edges.some((e) => e.kind === 'out' && e.indirect !== true), true)
  assert.equal(second[1].boundary, true, 'c is still hidden: a stub')
})

test('an empty topology still links visible parents directly', () => {
  const commits = [commit('c', ['b']), commit('b', ['a']), commit('a', [])]
  const rows = layoutFilteredGraph(commits, [], 'compact')
  assert.equal(rows[0].edges.some((e) => e.kind === 'out' && e.indirect !== true), true)
  assert.equal(rows.some((r) => r.edges.some((e) => e.indirect === true)), false)
  assert.equal(rows.some((r) => r.boundary === true), false)
})

test('rows keep the original commit objects and the raw merge flags', () => {
  const commits = [commit('m', ['h1', 'h2']), commit('x', []), commit('y', [])]
  const topology = topo([['m', ['h1', 'h2']], ['h1', ['x']], ['h2', ['y']], ['x', []], ['y', []]])
  const rows = layoutFilteredGraph(commits, topology, 'parallel')
  rows.forEach((row, i) => assert.equal(row.commit, commits[i], 'the original object is preserved'))
  assert.equal(rows[0].merge, true)
  assert.equal(rows[1].merge, false)
})

test('empty inputs yield an empty layout', () => {
  assert.deepEqual(layoutFilteredGraph([], [], 'compact'), [])
  assert.deepEqual(layoutFilteredGraph([], topo([['a', []]]), 'parallel'), [])
})

/** Visible rows plus the hidden nodes the projection has to walk through. */
function graph(visible, hidden = []) {
  return { commits: visible.map(([hash, parents]) => commit(hash, parents)), topology: topo([...visible, ...hidden]) }
}

/** The dashed X-link and the solid X-link must keep their own style end to end. */
function assertDistinctStyles(rows, dashedFrom, solidFrom, filler, target) {
  const byHash = Object.fromEntries(rows.map((r) => [r.commit.hash, r]))
  assert.equal(byHash[dashedFrom].edges.filter((e) => e.kind === 'out' && e.indirect === true).length, 1, 'the dashed source keeps one dashed link')
  const solidOut = byHash[solidFrom].edges.filter((e) => e.kind === 'out')
  assert.equal(solidOut.length, 2, 'the solid source keeps both links')
  assert.equal(solidOut.filter((e) => e.indirect === true).length, 0, 'and neither inherits the dashed lane')
  const into = byHash[target].edges.filter((e) => e.kind === 'into')
  assert.equal(into.length, 2, 'both lines converge at the target')
  const dashedInto = into.find((e) => e.indirect === true)
  const solidInto = into.find((e) => e.indirect !== true)
  assert.ok(dashedInto !== undefined && solidInto !== undefined, 'one dashed and one solid into-edge')
  const passes = byHash[filler].edges.filter((e) => e.kind === 'pass')
  assert.equal(passes.some((e) => e.toLane === dashedInto.fromLane && e.indirect === true), true, 'the dashed lane stays dashed across the filler row')
  assert.equal(passes.some((e) => e.toLane === solidInto.fromLane && e.indirect !== true), true, 'the solid lane stays solid across the filler row')
}

test('a later solid extra parent never reuses a dashed lane for the same target', () => {
  // A's hidden parent resolves to X (dashed); B's own parent is X (solid).
  const { commits, topology } = graph(
    [['A', ['P', 'hA']], ['B', ['Q', 'X']], ['F', []], ['X', []], ['P', []], ['Q', []]],
    [['hA', ['X']]],
  )
  for (const style of STYLES) {
    assertDistinctStyles(layoutFilteredGraph(commits, topology, style), 'A', 'B', 'F', 'X')
  }
})

test('a later indirect extra parent never reuses a solid lane for the same target', () => {
  // A's own parent is X (solid); B's hidden parent resolves to X (dashed).
  const { commits, topology } = graph(
    [['A', ['P', 'X']], ['B', ['Q', 'hB']], ['F', []], ['X', []], ['P', []], ['Q', []]],
    [['hB', ['X']]],
  )
  for (const style of STYLES) {
    assertDistinctStyles(layoutFilteredGraph(commits, topology, style), 'B', 'A', 'F', 'X')
  }
})

test('a visible commit keeps its own parents over a truncated topology entry', () => {
  // Topology claims c is a root; the commit object is authoritative.
  const commits = [commit('c', ['b']), commit('b', [])]
  const rows = layoutFilteredGraph(commits, topo([['c', []], ['b', []]]), 'compact')
  assert.equal(rows[0].boundary, undefined, 'a real parent is not turned into a fake root')
  assert.equal(rows[0].edges.some((e) => e.kind === 'out' && e.indirect !== true), true)
  assert.equal(rows[1].edges.some((e) => e.kind === 'into'), true)
})

test('a target that is not below its source is rejected', () => {
  // Partial data across generations: p is shown above its child c — no back edge.
  const rows = layoutFilteredGraph([commit('p', []), commit('c', ['p'])], topo([['p', []], ['c', ['p']]]), 'compact')
  assert.equal(rows[1].edges.length, 0, 'nothing is drawn upwards')
  assert.equal(rows[1].boundary, true)
  // A self-link is rejected as well.
  const self = layoutFilteredGraph([commit('s', ['s'])], topo([['s', ['s']]]), 'compact')
  assert.equal(self[0].edges.length, 0)
  assert.equal(self[0].boundary, true)
})

test('a long hidden chain feeding many visible roots stays correct', () => {
  // 5k hidden single-parent nodes ending in one hidden merge onto 200 visible
  // roots: the wide ancestor set must be shared, not copied per link.
  const chain = 5000
  const roots = 200
  const visible = [['top', ['h0']]]
  for (let i = 0; i < roots; i++) visible.push([`r${i}`, []])
  const hidden = []
  for (let i = 0; i < chain - 1; i++) hidden.push([`h${i}`, [`h${i + 1}`]])
  hidden.push([`h${chain - 1}`, Array.from({ length: roots }, (_, i) => `r${i}`)])
  const { commits, topology } = graph(visible, hidden)
  const rows = layoutFilteredGraph(commits, topology, 'compact')
  assert.equal(rows.length, visible.length, 'every commit keeps its row')
  const out = rows[0].edges.filter((e) => e.kind === 'out')
  assert.equal(out.length, roots, 'each visible root gets its own dashed link')
  assert.equal(out.every((e) => e.indirect === true), true)
  assert.equal(rows[0].boundary, undefined, 'the whole chain is known, so nothing dangles')
  for (let i = 1; i <= roots; i++) {
    assert.equal(rows[i].edges.filter((e) => e.kind === 'into').length, 1, `r${i - 1} is reached once`)
  }
})

test('a dense merge window stops at the display-link budget', () => {
  // 200 commits, each merging the next 30: ~5.5k display links without the cap.
  const total = 200
  const visible = []
  for (let i = 0; i < total; i++) {
    const parents = []
    for (let k = 1; k <= 30 && i + k < total; k++) parents.push(`c${i + k}`)
    visible.push([`c${i}`, parents])
  }
  for (const style of STYLES) {
    const { commits, topology } = graph(visible)
    const rows = layoutFilteredGraph(commits, topology, style)
    assert.equal(rows.length, total, `${style}: every commit keeps its row`)
    const out = rows.reduce((n, r) => n + r.edges.filter((e) => e.kind === 'out').length, 0)
    assert.ok(out <= 4096, `${style}: out edges stay within the budget (${out})`)
    assert.equal(rows.some((r) => r.boundary === true), true, `${style}: the omitted links are flagged`)
    assert.equal(rows.every((r) => Number.isInteger(r.lane)), true, `${style}: every row still has a node`)
  }
})

test('long-span links are bounded by the row-span budget', () => {
  // 1200 rows; the top row links far down the list. Without the span budget the
  // projection would paint ~540k pass edges (one per row each link crosses); with
  // it the tail of those links becomes a boundary stub. The budget is
  // conservative — it does not promise to draw the whole graph.
  const total = 1200
  const visible = []
  for (let i = 0; i < total; i++) {
    const parents = i === 0
      ? ['c1', ...Array.from({ length: total - 600 }, (_, k) => `c${600 + k}`)]
      : i + 1 < total ? [`c${i + 1}`] : []
    visible.push([`c${i}`, parents])
  }
  for (const style of STYLES) {
    const { commits, topology } = graph(visible)
    const rows = layoutFilteredGraph(commits, topology, style)
    assert.equal(rows.length, total, `${style}: every commit keeps its row`)
    const edges = rows.reduce((n, r) => n + r.edges.length, 0)
    assert.ok(edges <= 110_000, `${style}: total edges stay bounded (${edges})`)
    assert.equal(rows[0].boundary, true, `${style}: the links that did not fit are flagged`)
  }
})

test('a compact reroute keeps a pass in a lane of its own nature', () => {
  // A reaches P across hidden H (dashed); B merges [Q, C]; D and C both reach P
  // directly. At C the solid P lane is folded into C's lane, so the pass of the
  // old lane must follow the SOLID P lane — not the dashed one waiting at 0.
  const { commits, topology } = graph(
    [['A', ['H']], ['B', ['Q', 'C']], ['D', ['P']], ['C', ['P']], ['P', []], ['Q', []]],
    [['H', ['P']]],
  )
  for (const style of STYLES) {
    const rows = layoutFilteredGraph(commits, topology, style)
    const byHash = Object.fromEntries(rows.map((r) => [r.commit.hash, r]))
    const into = byHash.P.edges.filter((e) => e.kind === 'into')
    assert.equal(into.filter((e) => e.indirect === true).length, 1, `${style}: exactly one dashed line reaches P`)
    assert.ok(into.filter((e) => e.indirect !== true).length >= 1, `${style}: the direct line stays solid`)
    const dashedFrom = into.find((e) => e.indirect === true).fromLane
    const passes = byHash.C.edges.filter((e) => e.kind === 'pass')
    assert.equal(passes.some((e) => e.toLane === dashedFrom && e.indirect !== true), false, `${style}: no solid pass lands in the dashed lane`)
    assert.equal(passes.some((e) => e.toLane === dashedFrom && e.indirect === true), true, `${style}: the dashed line keeps its own lane`)
  }
})
