/**
 * Nested-repository discovery (issue #83): the cwd scan, the cwd-relative
 * selector resolution, and the host endpoints that expose them. Directories are
 * real (temp dir); git calls use a child-process stand-in like the host
 * integration test, so the assertions run against production wiring.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn as nodeSpawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFsDeps } from '../../lib/host/fs-deps.js'
import { listSessionRepos, resolveWorkspace } from '../../lib/host/core.js'
import { repoDirFor, scanRepos } from '../../lib/host/repos.js'
import { DEFAULT_CONFIG, createGitRunner, runQuery, snapshotForSession } from '../../lib/host/index.js'

/** child_process-backed subprocess service matching SubprocessLike. */
const subprocess = {
  spawn(spec) {
    const child = nodeSpawn(spec.argv[0], spec.argv.slice(1), { cwd: spec.cwd })
    if (typeof spec.stdio.stdin === 'object') child.stdin.end(spec.stdio.stdin.data)
    else child.stdin.end()
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    const done = new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('close', (code, signal) => resolve({ exitCode: code, signal }))
    })
    return {
      done,
      collected: {
        stdout: { readFrom: () => ({ text: out, lossy: false }) },
        stderr: { readFrom: () => ({ text: err, lossy: false }) },
      },
    }
  },
}

function runGit(cwd, args) {
  return new Promise((resolve, reject) => {
    const c = nodeSpawn('git', args, { cwd })
    let err = ''
    c.stderr.on('data', (d) => { err += d })
    c.on('close', (code) => (code === 0 ? resolve() : reject(new Error('git ' + args.join(' ') + ': ' + err))))
  })
}

/** A deps face locked to `dir`, using the production wiring. */
function depsAt(dir) {
  return {
    run: createGitRunner(subprocess, DEFAULT_CONFIG.timeoutMs, DEFAULT_CONFIG.maxBytes),
    fs: createFsDeps(),
    sessions: { liveCwd: () => dir, persistedMeta: async () => undefined },
  }
}

const SID = 'test-session'
let tmp
let ws
let outer

before(async () => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'gp-repos-')))
  ws = join(tmp, 'ws')
  // A plain workspace directory holding repositories instead of being one.
  for (const dir of ['site', 'api', 'group/deep', 'node_modules/pkg', 'a/b/c/d']) {
    mkdirSync(join(ws, dir, '.git'), { recursive: true })
  }
  mkdirSync(join(ws, 'plain'), { recursive: true })

  outer = join(tmp, 'outer')
  mkdirSync(outer)
  await runGit(outer, ['init', '-q'])
  await runGit(outer, ['config', 'user.email', 't@t.co'])
  await runGit(outer, ['config', 'user.name', 'Tester'])
  await runGit(outer, ['commit', '--allow-empty', '-qm', 'init'])
  mkdirSync(join(outer, 'sub'))
  await runGit(join(outer, 'sub'), ['init', '-q'])
})

after(() => {
  rmSync(tmp, { recursive: true, force: true })
})

test('scanRepos lists repository roots below the cwd and skips dependency dirs', async () => {
  const found = await scanRepos(createFsDeps(), ws)
  assert.deepEqual(found.map((r) => r.path), ['api', 'group/deep', 'site'])
  assert.equal(found[0].name, 'api')
  assert.equal(found[0].root, realpathSync(join(ws, 'api')))
})

test('scanRepos stops at the depth ceiling', async () => {
  // a/b/c/d/.git sits four levels down: the default scan (depth 3) never
  // reaches it, so a deep-but-unrelated tree cannot slow every panel mount.
  const shallow = await scanRepos(createFsDeps(), ws)
  assert.equal(shallow.some((r) => r.path.includes('c/d')), false)
  const deep = await scanRepos(createFsDeps(), ws, { depth: 6 })
  assert.equal(deep.some((r) => r.path === 'a/b/c/d'), true)
})

test('scanRepos honors the result ceiling', async () => {
  const one = await scanRepos(createFsDeps(), ws, { resultLimit: 1 })
  assert.equal(one.length, 1)
})

test('repoDirFor accepts safe cwd-relative paths only', async () => {
  const fs = createFsDeps()
  assert.deepEqual(await repoDirFor(fs, ws, 'site'), { ok: true, dir: realpathSync(join(ws, 'site')) })
  for (const bad of ['', '.', '..', '../outside', 'site/.git', join(ws, 'site'), 'missing']) {
    assert.deepEqual(await repoDirFor(fs, ws, bad), { ok: false }, 'must reject ' + JSON.stringify(bad))
  }
})

test('listSessionRepos reports the workspace repository plus nested ones', async () => {
  const listed = await listSessionRepos(depsAt(outer), SID)
  assert.equal(listed.ok, true)
  assert.equal(listed.value.cwd, realpathSync(outer))
  const entries = listed.value.repos.map((r) => [r.path, r.kind, r.name])
  assert.deepEqual(entries, [
    ['', 'workspace', 'outer'],
    ['sub', 'nested', 'sub'],
  ])
})

test('a cwd outside any repository reports only nested repositories', async () => {
  const listed = await listSessionRepos(depsAt(ws), SID)
  assert.equal(listed.ok, true)
  assert.deepEqual(listed.value.repos.map((r) => r.kind), ['nested', 'nested', 'nested'])
})

test('repo-list is served by the query endpoint', async () => {
  const res = await runQuery(depsAt(outer), DEFAULT_CONFIG, {
    sessionId: SID,
    query: { kind: 'repo-list' },
  })
  assert.equal(res.ok, true)
  assert.equal(res.value.kind, 'repo-list')
  assert.deepEqual(res.value.repos.map((r) => r.path), ['', 'sub'])
})

test('a snapshot samples the selected nested repository', async () => {
  const snap = await snapshotForSession(depsAt(outer), DEFAULT_CONFIG, SID, { repo: 'sub' })
  assert.equal(snap.ok, true)
  assert.equal(snap.value.root, realpathSync(join(outer, 'sub')))
})

test('an unknown or escaping selector fails as invalid-repo', async () => {
  for (const repo of ['missing', '../outer/sub', join(outer, 'sub')]) {
    const resolved = await resolveWorkspace(depsAt(outer), SID, repo)
    assert.equal(resolved.ok, false, 'must reject ' + JSON.stringify(repo))
    assert.equal(resolved.failure.error.code, 'invalid-repo')
    const snap = await snapshotForSession(depsAt(outer), DEFAULT_CONFIG, SID, { repo })
    assert.equal(snap.ok, false)
    assert.equal(snap.error.code, 'invalid-repo')
  }
})

test('a directory that is not a repository fails as invalid-repo', async () => {
  mkdirSync(join(outer, 'plain'), { recursive: true })
  const snap = await snapshotForSession(depsAt(outer), DEFAULT_CONFIG, SID, { repo: 'plain' })
  assert.equal(snap.ok, false)
  assert.equal(snap.error.code, 'invalid-repo')
})
