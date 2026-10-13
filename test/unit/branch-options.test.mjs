/**
 * Switch-target option model behind the branch rows' switch buttons:
 * remote-ref splitting, the local-branch shadowing rule, and the
 * current-branch lock.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitRemoteRef, buildBranchOptions, isSelectable } from '../../lib/testkit.mjs'

test('splitRemoteRef peels the remote off a refs/remotes short name', () => {
  assert.deepEqual(splitRemoteRef('origin/main'), { remote: 'origin', branch: 'main' })
  assert.deepEqual(splitRemoteRef('upstream/feature/x'), { remote: 'upstream', branch: 'feature/x' })
  assert.equal(splitRemoteRef('HEAD'), null, 'no remote prefix')
  assert.equal(splitRemoteRef('/main'), null, 'leading slash')
  assert.equal(splitRemoteRef('origin/'), null, 'nothing after the slash')
})

test('buildBranchOptions lists locals then remotes, resolving each row to a local branch', () => {
  const options = buildBranchOptions({
    current: 'main',
    local: [{ name: 'main', shortHash: 'aaaaaaa' }, { name: 'release', shortHash: 'bbbbbbb', ahead: 2 }],
    remote: [
      { name: 'origin/main', shortHash: 'aaaaaaa' },
      { name: 'origin/feature', shortHash: 'ccccccc' },
      { name: 'HEAD', shortHash: 'aaaaaaa' },
    ],
  })
  assert.deepEqual(options.map((o) => o.key), ['local:main', 'local:release', 'remote:origin/main', 'remote:origin/feature'],
    'locals first; a remote ref without a prefix is dropped')
  const [main, release, remoteMain, remoteFeature] = options
  assert.equal(main.name, 'main')
  assert.equal(main.group, 'local')
  assert.equal(release.ahead, 2, 'local tracking counts ride along')
  // A remote row always resolves to the local branch `x`: reuse it when it
  // exists (switching to `origin/main` would detach HEAD instead).
  assert.equal(remoteMain.name, 'main')
  assert.equal(remoteMain.label, 'origin/main')
  assert.equal(remoteMain.reused, true)
  assert.equal(remoteMain.createFrom, undefined, 'an existing local branch is reused, never re-created')
  assert.equal(remoteFeature.reused, false)
  assert.equal(remoteFeature.createFrom, 'origin/feature', 'a missing local branch is created from the remote ref')
  assert.equal(remoteFeature.name, 'feature')
})

test('isSelectable locks the branch that is already checked out', () => {
  const options = buildBranchOptions({
    current: 'main',
    local: [{ name: 'main', shortHash: 'a' }, { name: 'dev', shortHash: 'b' }],
    remote: [{ name: 'origin/main', shortHash: 'a' }],
  })
  assert.equal(isSelectable(options[0], 'main'), false, 'the current branch is inert')
  assert.equal(isSelectable(options[1], 'main'), true)
  assert.equal(isSelectable(options[2], 'main'), false, 'a remote row resolving to the current branch is inert too')
  assert.equal(isSelectable(options[1], null), true, 'a detached HEAD locks nothing')
})
