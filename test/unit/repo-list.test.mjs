/**
 * Repositories tab list model: which rows exist, what each row says, and how
 * they group.
 *
 * The load-bearing properties: an empty scan yields no tab at all (an older
 * host must keep the three-pane panel), a cwd that owns no checkout still gets
 * no synthetic "workspace root" row — only what the scan found — labels never
 * repeat a basename that already is the path, and the two checkout families
 * (the workspace's own worktrees vs unrelated repositories) split into groups
 * only when both are present — a lone group must not render a header that
 * restates the block title.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { repoChoices, repoLabel, repoDetail, repoGroups, repoDisabledKey } from '../../lib/testkit.mjs'

/** A scan entry; only the fields the list reads. */
function entry(path, name, kind) {
  return { path, name, kind, root: `/w/${path}` }
}

test('an empty scan yields no rows, so the panel keeps its three tabs', () => {
  assert.deepEqual(repoChoices([]), [])
})

test('a checkout that owns the cwd is listed as-is', () => {
  const rows = repoChoices([entry('', 'workspace', 'workspace'), entry('site', 'site', 'nested')])
  assert.deepEqual(rows.map((r) => r.path), ['', 'site'])
  assert.deepEqual(rows.map((r) => r.kind), ['workspace', 'repo'])
})

test('a cwd with no checkout of its own lists only the scanned repositories', () => {
  const rows = repoChoices([entry('alpha', 'alpha', 'nested')])
  assert.deepEqual(rows.map((r) => r.path), ['alpha'], 'no synthetic root row')
  assert.deepEqual(rows.map((r) => r.kind), ['repo'])
})

test('a linked worktree row keeps its wire fields and becomes the worktree kind', () => {
  const rows = repoChoices([
    { path: '', name: 'repo', kind: 'workspace', root: '/r', role: 'main', branch: 'main' },
    { path: '.agents/worktrees/feat/x', name: 'x', kind: 'nested', root: '/x', role: 'linked', branch: 'feat/x', locked: true },
    { path: 'site', name: 'site', kind: 'nested', root: '/s', role: 'repo' },
  ])
  assert.deepEqual(rows.map((r) => r.kind), ['workspace', 'worktree', 'repo'])
  assert.equal(rows[0].role, 'main')
  assert.equal(rows[1].branch, 'feat/x')
  assert.equal(rows[1].locked, true)
  // An older host sends none of the new fields: the row still lands in the
  // repository group instead of crashing or inventing a branch.
  const legacy = repoChoices([entry('', 'workspace', 'workspace'), entry('site', 'site', 'nested')])
  assert.equal(legacy[1].kind, 'repo')
  assert.equal(legacy[1].branch, undefined)
  assert.equal(legacy[1].disabled, undefined)
})

test('labels drop the path when it is the basename and keep it otherwise', () => {
  assert.equal(repoLabel(entry('site', 'site', 'nested')), 'site')
  assert.equal(repoLabel(entry('apps/web', 'web', 'nested')), 'web (apps/web)')
  assert.equal(repoLabel(entry('', 'workspace', 'workspace')), 'workspace')
})

test('the detail line is the relative path and is empty where it adds nothing', () => {
  assert.equal(repoDetail(entry('apps/web', 'web', 'nested')), 'apps/web')
  assert.equal(repoDetail(entry('alpha', 'alpha', 'nested')), '', 'the name already is the whole path')
  assert.equal(repoDetail(entry('', 'workspace', 'workspace')), '')
})

test('a worktree label is the name alone and its detail drops the repeated directory', () => {
  const wt = { path: '.agents/worktrees/review/pr-85', name: 'pr-85', kind: 'worktree', root: '/r' }
  assert.equal(repoLabel(wt), 'pr-85', 'the path lives on the detail line only')
  assert.equal(repoDetail(wt), '.agents/worktrees/review', 'repeating pr-85 under pr-85 only adds noise')
})

test('groups split the family from the workspace; a single group stays alone', () => {
  const own = { path: '', name: 'repo', kind: 'workspace', root: '/r' }
  const wt = { path: 'wts/a', name: 'a', kind: 'worktree', root: '/a', branch: 'a' }
  const foreign = { path: 'site', name: 'site', kind: 'repo', root: '/s' }

  const one = repoGroups([own, wt])
  assert.equal(one.length, 1, 'one family earns no header')
  assert.equal(one[0].key, 'own')
  assert.equal(one[0].selectable, 2)

  const both = repoGroups([own, wt, foreign])
  assert.deepEqual(both.map((g) => g.key), ['own', 'foreign'], 'the family leads, the workspace follows')
  assert.deepEqual(both.map((g) => g.items.length), [2, 1])

  const onlyForeign = repoGroups([foreign])
  assert.equal(onlyForeign.length, 1, 'a non-checkout workspace is one flat list, as before')
  assert.equal(onlyForeign[0].key, 'foreign')
  assert.equal(repoGroups([]).length, 0)
})

test('disabled rows count in the group but not as selectable', () => {
  const rows = [
    { path: '', name: 'repo', kind: 'workspace', root: '/r' },
    { path: 'wt/out', name: 'out', kind: 'worktree', root: '/o', disabled: 'outside' },
    { path: 'wt/gone', name: 'gone', kind: 'worktree', root: '/g', disabled: 'stale' },
  ]
  const groups = repoGroups(rows)
  assert.equal(groups[0].items.length, 3)
  assert.equal(groups[0].selectable, 1, 'the count badge must show both numbers')
  assert.equal(repoDisabledKey(rows[1]), 'repos.disabled.outside')
  assert.equal(repoDisabledKey(rows[2]), 'repos.disabled.stale')
  assert.equal(repoDisabledKey(rows[0]), null, 'an ordinary row carries no reason')
})
