/**
 * Repositories tab list model: which rows exist, and what each row says.
 *
 * Three properties are load-bearing and invisible in a screenshot: an empty
 * scan yields no tab at all (an older host must keep the three-pane panel), a
 * cwd that owns no checkout leads with the way back, and the label never
 * repeats a basename that already is the whole relative path.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { repoChoices, repoLabel, repoDetail } from '../../lib/testkit.mjs'

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
  assert.deepEqual(rows.map((r) => r.kind), ['workspace', 'nested'])
})

test('a cwd with no checkout of its own leads with the synthetic root row', () => {
  const rows = repoChoices([entry('alpha', 'alpha', 'nested')])
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], { path: '', name: null, root: '', kind: 'root' })
  assert.equal(rows[1].path, 'alpha')
})

test('labels drop the path when it is the basename and keep it otherwise', () => {
  assert.equal(repoLabel(entry('site', 'site', 'nested')), 'site')
  assert.equal(repoLabel(entry('apps/web', 'web', 'nested')), 'web (apps/web)')
  assert.equal(repoLabel(entry('', 'workspace', 'workspace')), 'workspace')
  assert.equal(repoLabel({ path: '', name: null, root: '', kind: 'root' }), '', 'the caller localizes the root row')
})

test('the detail line is the relative path and is empty where it adds nothing', () => {
  assert.equal(repoDetail(entry('apps/web', 'web', 'nested')), 'apps/web')
  assert.equal(repoDetail(entry('alpha', 'alpha', 'nested')), '', 'the name already is the whole path')
  assert.equal(repoDetail(entry('', 'workspace', 'workspace')), '')
  assert.equal(repoDetail({ path: '', name: null, root: '', kind: 'root' }), '')
})
