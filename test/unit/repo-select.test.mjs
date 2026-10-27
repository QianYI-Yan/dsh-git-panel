/**
 * Repository selection: the per-session map and the request-tagging face.
 *
 * The switcher's correctness rests on two properties that are cheap to pin and
 * expensive to lose: a session's pick never leaks into another session, and the
 * wrapper only ever adds `repo` to the requests that the host resolves per
 * repository. A version lookup must stay host-scoped — tagging it would make an
 * older host reject the call for an unknown field.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectedRepo, selectRepo, hasRepoPick, clearRepoPick, withRepo } from '../../lib/testkit.mjs'

/** A remote that records what reached it, keyed by method. */
function recordingRemote() {
  const calls = []
  const answer = (kind) => async (request, signal) => {
    calls.push({ kind, request, signal })
    return { ok: true, value: { ok: true, value: {} } }
  }
  return {
    calls,
    remote: {
      snapshot: answer('snapshot'),
      run: answer('run'),
      query: answer('query'),
      suggest: answer('suggest'),
      version: answer('version'),
      openFile: answer('openFile'),
    },
  }
}

test('a session starts on the cwd repository and can be pointed elsewhere', () => {
  assert.equal(selectedRepo('s1'), '', 'no selection means the cwd repository')
  selectRepo('s1', 'site')
  assert.equal(selectedRepo('s1'), 'site')
  selectRepo('s1', '')
  assert.equal(selectedRepo('s1'), '', "'' resets to the cwd repository")
  selectRepo('s1', 'nested/deep')
  selectRepo('s1', '')
  assert.equal(selectedRepo('s1'), '', "'' forgets the pick")
})

test('one session\'s pick never leaks into another', () => {
  selectRepo('a', 'one')
  selectRepo('b', 'two')
  assert.equal(selectedRepo('a'), 'one')
  assert.equal(selectedRepo('b'), 'two')
  assert.equal(selectedRepo('untouched'), '')
  selectRepo('a', '')
  selectRepo('b', '')
})

// Intent, not just the value: '' both clears the selection and means "the cwd
// repository", so without a separate marker a deliberate return to the root
// would look like "never picked" — and the panel's first-sub-repository
// default would fight the user who chose it.
test('a deliberate root pick counts as a choice, a repair does not', () => {
  assert.equal(hasRepoPick('intent-1'), false, 'a fresh session never picked anything')
  selectRepo('intent-1', 'site')
  assert.equal(hasRepoPick('intent-1'), true, 'a checkout pick records intent')
  selectRepo('intent-1', '')
  assert.equal(selectedRepo('intent-1'), '', "'' resets the selection")
  assert.equal(hasRepoPick('intent-1'), true, 'but the deliberate return to the root stays a choice')
  selectRepo('intent-1', 'other')
  assert.equal(hasRepoPick('intent-1'), true, 'picking again keeps the session in the picked state')
  clearRepoPick('intent-1')
  assert.equal(selectedRepo('intent-1'), '', 'a repair forgets the pick')
  assert.equal(hasRepoPick('intent-1'), false, 'and never records it as a root choice')
  assert.equal(hasRepoPick('intent-2'), false, 'intent never leaks across sessions')
})

test('an empty selection returns the original remote instead of a wrapper', () => {
  const { remote } = recordingRemote()
  assert.equal(withRepo(remote, ''), remote)
})

test('the wrapper tags every repository-scoped request and leaves the caller\'s object alone', async () => {
  const { calls, remote } = recordingRemote()
  const tagged = withRepo(remote, 'site')
  const request = { sessionId: 's' }
  const signal = new AbortController().signal

  await tagged.snapshot(request, signal)
  await tagged.run(request, signal)
  await tagged.query(request, signal)
  await tagged.suggest(request, signal)
  await tagged.openFile(request, signal)

  assert.deepEqual(calls.map((c) => c.kind), ['snapshot', 'run', 'query', 'suggest', 'openFile'])
  for (const call of calls) {
    assert.equal(call.request.repo, 'site', `${call.kind} carries the repository`)
    assert.equal(call.request.sessionId, 's', `${call.kind} keeps the session`)
  }
  assert.equal(request.repo, undefined, 'the caller\'s request object is not mutated')
  assert.equal(request.sessionId, 's')
})

test('a version lookup is host-scoped and is never tagged', async () => {
  const { calls, remote } = recordingRemote()
  const tagged = withRepo(remote, 'site')
  const signal = new AbortController().signal
  await tagged.version({ sessionId: 's' }, signal)
  // The signal rides through the wrapper for every method, including this one.
  assert.deepEqual(calls.map((c) => c.kind), ['version'])
  assert.equal(calls[0].request.repo, undefined, 'version must not carry a repository field')
  assert.equal(calls[0].signal, signal)
})
