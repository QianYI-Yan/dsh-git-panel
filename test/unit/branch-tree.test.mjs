/**
 * Branch-tree tests: flat ref names → nested dirs, input order preserved.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildBranchTree, pinPrimaryFirst, primaryBranchName } from '../../lib/testkit.mjs'

const br = (name, extra = {}) => ({ name, shortHash: 'abc1234', ...extra })

test('folds a dir where its first member appeared, leaves stay at root', () => {
  const tree = buildBranchTree([br('main'), br('feat/a'), br('pr-38')])
  assert.deepEqual(tree.map((n) => [n.kind, n.label]), [['leaf', 'main'], ['dir', 'feat'], ['leaf', 'pr-38']])
  const dir = tree[1]
  assert.equal(dir.path, 'feat')
  assert.equal(dir.self, null)
  assert.equal(dir.children.length, 1)
  assert.equal(dir.children[0].kind, 'leaf')
  assert.equal(dir.children[0].label, 'a')
  assert.equal(dir.children[0].path, 'feat/a')
})

test('groups sibling branches into one dir, keeping input order', () => {
  const tree = buildBranchTree([br('feat/b'), br('feat/a')])
  assert.equal(tree.length, 1)
  assert.equal(tree[0].kind, 'dir')
  assert.deepEqual(tree[0].children.map((c) => c.label), ['b', 'a'])
})

test('nests dirs', () => {
  const tree = buildBranchTree([br('feat/a/x'), br('feat/a/y'), br('feat/b')])
  const feat = tree[0]
  assert.equal(feat.label, 'feat')
  assert.deepEqual(feat.children.map((c) => [c.kind, c.label]), [['dir', 'a'], ['leaf', 'b']])
  const a = feat.children[0]
  assert.equal(a.path, 'feat/a')
  assert.deepEqual(a.children.map((c) => c.label), ['x', 'y'])
})

test('merges a single-child dir chain into its full path', () => {
  const tree = buildBranchTree([br('a/b/c/x')])
  assert.equal(tree[0].kind, 'dir')
  assert.equal(tree[0].label, 'a/b/c')
  assert.equal(tree[0].path, 'a/b/c')
  assert.deepEqual(tree[0].children.map((c) => c.label), ['x'])
})

test('keeps a dir visible when its only child is a leaf', () => {
  const tree = buildBranchTree([br('feat/x')])
  assert.equal(tree.length, 1)
  assert.equal(tree[0].kind, 'dir')
  assert.equal(tree[0].label, 'feat')
  assert.deepEqual(tree[0].children.map((c) => c.label), ['x'])
})

test('attaches a branch named like its dir to self, not a duplicate leaf', () => {
  const feat = br('feat')
  const tree = buildBranchTree([feat, br('feat/a')])
  assert.equal(tree.length, 1)
  assert.equal(tree[0].kind, 'dir')
  assert.equal(tree[0].label, 'feat')
  assert.equal(tree[0].self, feat)
  assert.deepEqual(tree[0].children.map((c) => c.label), ['a'])
})

test('self attaches to a dir created by an earlier-ordered descendant', () => {
  const feat = br('feat')
  const tree = buildBranchTree([br('feat/a'), feat])
  assert.equal(tree.length, 1)
  assert.equal(tree[0].kind, 'dir')
  assert.equal(tree[0].label, 'feat')
  assert.equal(tree[0].self, feat)
})

test('folds remote refs under the remote name', () => {
  const tree = buildBranchTree([br('origin/main'), br('origin/feat/a'), br('origin/feat/b')])
  assert.equal(tree.length, 1)
  const origin = tree[0]
  assert.equal(origin.label, 'origin')
  assert.deepEqual(origin.children.map((c) => [c.kind, c.label]), [['leaf', 'main'], ['dir', 'feat']])
  assert.deepEqual(origin.children[1].children.map((c) => c.label), ['a', 'b'])
})

test('preserves input order across mixed leaves and dirs', () => {
  const tree = buildBranchTree([br('z'), br('a/x'), br('b'), br('a/y')])
  assert.deepEqual(tree.map((n) => n.label), ['z', 'a', 'b'])
  assert.deepEqual(tree[1].children.map((c) => c.label), ['x', 'y'])
})

test('leaves carry the original branch object', () => {
  const main = br('main', { ahead: 2, behind: 3 })
  const leaf = br('feat/a')
  const tree = buildBranchTree([main, leaf])
  assert.equal(tree[0].branch, main)
  assert.equal(tree[0].branch.ahead, 2)
  assert.equal(tree[0].branch.behind, 3)
  assert.equal(tree[1].children[0].branch, leaf)
})

test('empty input yields an empty tree', () => {
  assert.deepEqual(buildBranchTree([]), [])
})

test('skips names with no non-empty segment', () => {
  const tree = buildBranchTree([br(''), br('/'), br('main')])
  assert.deepEqual(tree.map((n) => n.label), ['main'])
})

test('drops empty segments (a//b behaves like a/b)', () => {
  const tree = buildBranchTree([br('a//b')])
  assert.equal(tree.length, 1)
  assert.equal(tree[0].label, 'a')
  assert.equal(tree[0].children[0].label, 'b')
  assert.equal(tree[0].children[0].path, 'a/b')
})

test('never mutates the input array or branch objects', () => {
  const input = [br('feat/a'), br('feat'), br('main')]
  const snapshot = JSON.stringify(input)
  const first = input[0]
  buildBranchTree(input)
  assert.equal(JSON.stringify(input), snapshot)
  assert.equal(input.length, 3)
  assert.equal(input[0], first)
  assert.deepEqual(Object.keys(input[1]), ['name', 'shortHash'])
})

test('does not merge a dir that carries a self branch', () => {
  const feat = br('feat')
  const tree = buildBranchTree([feat, br('feat/a/x')])
  assert.equal(tree[0].label, 'feat')
  assert.equal(tree[0].path, 'feat')
  assert.equal(tree[0].self, feat)
  assert.deepEqual(tree[0].children.map((c) => [c.kind, c.label]), [['dir', 'a']])
  assert.deepEqual(tree[0].children[0].children.map((c) => c.label), ['x'])
})

test('every node path is its parent path plus its display label', () => {
  const input = [
    br('main'), br('feat/branch-tree'), br('feat/steady-state'), br('pr-38'),
    br('origin/main'), br('origin/feat/branch-tree'), br('origin/feat/dropdown'),
    br('release/1.0'), br('release/2.0'), br('a/b/c/x'),
  ]
  const tree = buildBranchTree(input)
  const seen = []
  const walk = (nodes, prefix) => {
    for (const node of nodes) {
      // The label is what the row shows, so it is relative to the parent row;
      // a chain-merged dir keeps its whole merged chain (e.g. 'a/b/c' at root).
      assert.equal(node.path, `${prefix}${node.label}`, `${node.path} vs ${prefix}${node.label}`)
      if (node.kind === 'leaf') { seen.push(node.path); continue }
      if (node.self !== null) seen.push(node.self.name)
      walk(node.children, `${node.path}/`)
    }
  }
  walk(tree, '')
  assert.deepEqual([...seen].sort(), input.map((b) => b.name).sort())
})

test('folds a nested remote ref set into origin + feat', () => {
  const tree = buildBranchTree([br('origin/main'), br('origin/feat/branch-tree'), br('origin/feat/dropdown-menu')])
  assert.deepEqual(tree.map((n) => [n.kind, n.label]), [['dir', 'origin']])
  const origin = tree[0]
  assert.deepEqual(origin.children.map((c) => [c.kind, c.label, c.path]), [
    ['leaf', 'main', 'origin/main'],
    ['dir', 'feat', 'origin/feat'],
  ])
  assert.deepEqual(origin.children[1].children.map((c) => c.label), ['branch-tree', 'dropdown-menu'])
})

test('a merged chain under a dir is labelled relative to it', () => {
  const tree = buildBranchTree([br('feat/x'), br('feat/a/b/y')])
  assert.deepEqual(tree.map((n) => [n.kind, n.label]), [['dir', 'feat']])
  assert.deepEqual(tree[0].children.map((c) => [c.kind, c.label, c.path]), [
    ['leaf', 'x', 'feat/x'],
    ['dir', 'a/b', 'feat/a/b'],
  ])
})

test('primaryBranchName prefers the repo default, then main, then master', () => {
  const local = [br('feat/x'), br('main'), br('master')]
  assert.equal(primaryBranchName(local, 'master'), 'master')
  assert.equal(primaryBranchName(local, 'develop'), 'main')
  assert.equal(primaryBranchName(local, null), 'main')
  assert.equal(primaryBranchName([br('master'), br('feat/x')], null), 'master')
  assert.equal(primaryBranchName([br('develop'), br('feat/x')], null), null)
  assert.equal(primaryBranchName([], 'main'), null)
})

test('pinPrimaryFirst moves the primary ref to the front, order otherwise stable', () => {
  const branches = [br('feat/x'), br('main'), br('pr-38')]
  assert.deepEqual(pinPrimaryFirst(branches, 'main').map((b) => b.name), ['main', 'feat/x', 'pr-38'])
  // Already first, no match or no primary: the very same array comes back.
  assert.equal(pinPrimaryFirst(branches, 'feat/x'), branches)
  assert.equal(pinPrimaryFirst(branches, 'release'), branches)
  assert.equal(pinPrimaryFirst(branches, null), branches)
  // Remote tracking refs pin by their full name.
  const remote = [br('origin/release'), br('origin/main')]
  assert.deepEqual(pinPrimaryFirst(remote, 'origin/main').map((b) => b.name), ['origin/main', 'origin/release'])
})
