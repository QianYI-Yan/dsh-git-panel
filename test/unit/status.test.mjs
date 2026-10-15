/**
 * isUntrackedPath: Git's tracking state for one browser path. Porcelain
 * collapses an untracked directory into a single `?? dir/` entry, so a file
 * inside it carries no change of its own — it must be recognised through its
 * untracked ancestor directory, not mislabeled as tracked.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isUntrackedPath } from '../../lib/testkit.mjs'

function change(path, status, staged, isDirectory = false) {
  return { path, status, staged, isDirectory }
}

test('isUntrackedPath matches an exact untracked file entry', () => {
  const changes = [change('a.txt', 'untracked', false)]
  assert.equal(isUntrackedPath(changes, 'a.txt'), true)
  assert.equal(isUntrackedPath(changes, 'b.txt'), false)
})

test('isUntrackedPath recognises files inside a collapsed untracked directory', () => {
  const changes = [change('new-dir', 'untracked', false, true)]
  assert.equal(isUntrackedPath(changes, 'new-dir/a.txt'), true)
  assert.equal(isUntrackedPath(changes, 'new-dir/sub/deep.txt'), true)
  // A sibling whose name merely shares the prefix is not inside the directory.
  assert.equal(isUntrackedPath(changes, 'new-dir-2/a.txt'), false)
})

test('isUntrackedPath ignores directories and tracked statuses', () => {
  const changes = [
    change('src', 'modified', false, true),
    change('a.txt', 'modified', false),
    change('b.txt', 'modified', false),
  ]
  assert.equal(isUntrackedPath(changes, 'src/a.txt'), false)
  assert.equal(isUntrackedPath(changes, 'a.txt'), false)
  assert.equal(isUntrackedPath([], 'a.txt'), false)
})

test('isUntrackedPath is not fooled by a staged-add directory', () => {
  // A staged new directory lists its files individually; the directory entry is
  // not untracked, so its children stay their own facts.
  const changes = [change('new-dir', 'added', true, true), change('new-dir/a.txt', 'added', true)]
  assert.equal(isUntrackedPath(changes, 'new-dir/a.txt'), false)
  assert.equal(isUntrackedPath(changes, 'new-dir/other.txt'), false)
})
