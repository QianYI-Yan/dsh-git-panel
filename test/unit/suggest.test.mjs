/**
 * Suggest-endpoint tests: real git repositories in a temp dir drive the diff
 * collection; a stub LLM stream drives the model-call side. Covers framing
 * (files + diff + recent message), untracked fold-in, path filtering, unborn
 * repos, truncation, route resolution (agent default vs config override),
 * finish-reason error mapping against the real `{ type:'finish'; reason }`
 * chunk envelope, timeout, suggest-disabled, and missing-service degradation.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn as nodeSpawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { realpath, readFile, readdir, rm, stat } from 'node:fs/promises'
import { runSuggest, createGitRunner, DEFAULT_CONFIG, normalizeConfig } from '../../lib/host/index.js'
import { SUGGEST_LIMITS } from '../../lib/host/types.js'

let repo
let unborn
const SID = 'test-session'

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
    // In-memory collect semantics of the real service, no spill (equivalent
    // to its spill-unavailable degradation): over the per-stream cap the read
    // is the truncated prefix and lossy.
    return {
      done,
      collected: {
        stdout: { readFrom: () => {
          const cap = spec.stdio.stdout.collect.maxBytes
          return Buffer.byteLength(out) > cap ? { text: out.slice(0, cap), lossy: true } : { text: out, lossy: false }
        } },
        stderr: { readFrom: () => {
          const cap = spec.stdio.stderr.collect.maxBytes
          return Buffer.byteLength(err) > cap ? { text: err.slice(0, cap), lossy: true } : { text: err, lossy: false }
        } },
      },
    }
  },
}

function runGit(cwd, args) {
  return new Promise((resolve, reject) => {
    const c = nodeSpawn('git', args, { cwd })
    let err = ''
    c.stderr.on('data', (d) => { err += d })
    c.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`git ${args.join(' ')}: ${err}`))))
  })
}

function depsFor(dir, extra = {}) {
  return {
    run: createGitRunner(subprocess, DEFAULT_CONFIG.timeoutMs, DEFAULT_CONFIG.maxBytes),
    fs: {
      realpath, stat: (p) => stat(p), readFile: (p) => readFile(p),
      readdir: async (p) => (await readdir(p, { withFileTypes: true })).map((e) => ({ name: e.name, isDirectory: e.isDirectory() })),
      remove: (p) => rm(p, { force: true }),
    },
    sessions: { liveCwd: () => dir, persistedMeta: async () => undefined },
    ...extra,
  }
}

/** The default-model face returning a fixed route. */
function defaultRoute(provider = 'p1', model = 'm1') {
  return { currentSelection: () => ({ provider, model }) }
}

/**
 * A stub LLM face recording every call and replaying a chunk script. Chunks
 * use the real StreamChunk envelope: text-delta carries `text`, the terminal
 * finish chunk carries `reason` (never a top-level `kind`).
 */
function stubLlm(chunks, { streamError, onSignalAbort } = {}) {
  const calls = []
  const face = {
    calls,
    async *stream(options) {
      calls.push(options)
      if (onSignalAbort !== undefined) {
        await new Promise((resolve) => {
          const abort = () => resolve()
          if (options.signal?.aborted === true) abort()
          else options.signal?.addEventListener('abort', abort, { once: true })
        })
        if (streamError !== undefined) throw streamError
      }
      for (const chunk of chunks) yield chunk
    },
  }
  return face
}

const OK_CHUNKS = [
  { type: 'text-delta', index: 0, text: 'fix(parser): handle NUL records' },
  { type: 'text-delta', index: 0, text: '\n\nBody line' },
  { type: 'finish', reason: { kind: 'stop' } },
]

before(async () => {
  repo = mkdtempSync(join(tmpdir(), 'gp-suggest-'))
  await runGit(repo, ['init', '-q'])
  await runGit(repo, ['config', 'user.email', 't@t.co'])
  await runGit(repo, ['config', 'user.name', 'Tester'])
  await runGit(repo, ['commit', '--allow-empty', '-qm', 'init: first commit'])
  writeFileSync(join(repo, 'a.ts'), 'export const a = 1\n')
  await runGit(repo, ['add', 'a.ts'])
  await runGit(repo, ['commit', '-qm', 'feat: add a.ts'])
  // A long file makes diffs long enough to exercise truncation caps.
  writeFileSync(join(repo, 'b.ts'), Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n') + '\n')
  await runGit(repo, ['add', 'b.ts'])
  await runGit(repo, ['commit', '-qm', 'feat: add b.ts'])
  writeFileSync(join(repo, 'b.ts'), 'line 0\nchanged line\n' + Array.from({ length: 198 }, (_, i) => `line ${i + 2}`).join('\n') + '\n')
  writeFileSync(join(repo, 'new.txt'), 'brand new\n')
  writeFileSync(join(repo, 'unselected.txt'), 'not in selection\n')

  unborn = mkdtempSync(join(tmpdir(), 'gp-suggest-unborn-'))
  await runGit(unborn, ['init', '-q'])
  writeFileSync(join(unborn, 'x.txt'), 'hello\n')
})

after(() => {
  rmSync(repo, { recursive: true, force: true })
  rmSync(unborn, { recursive: true, force: true })
})

test('success: returns the assembled message and both delta texts', async () => {
  const llm = stubLlm(OK_CHUNKS)
  const deps = depsFor(repo, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
  const res = await runSuggest(deps, DEFAULT_CONFIG, { sessionId: SID })
  assert.equal(res.ok, true)
  if (res.ok) {
    assert.equal(res.value.message, 'fix(parser): handle NUL records\n\nBody line')
    assert.equal(res.value.provider, 'p1')
    assert.equal(res.value.model, 'm1')
    assert.equal(res.value.truncated, undefined)
  }
  assert.equal(llm.calls.length, 1)
})

test('frames files, diff, and recent commit message as JSON for the model', async () => {
  const llm = stubLlm(OK_CHUNKS)
  const deps = depsFor(repo, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
  await runSuggest(deps, DEFAULT_CONFIG, { sessionId: SID })
  const options = llm.calls[0]
  assert.equal(options.provider, 'p1')
  assert.equal(options.model, 'm1')
  assert.equal(options.maxTokens, DEFAULT_CONFIG.suggestMaxOutputTokens)
  assert.equal(options.temperature, 0.3)
  assert.match(options.system, /commit messages/)
  // The one-shot message satisfies the durable Message contract (id + source).
  assert.equal(options.messages[0].role, 'user')
  assert.equal(options.messages[0].source.kind, 'user')
  assert.equal(typeof options.messages[0].id, 'string')
  const frame = JSON.parse(options.messages[0].content[0].text)
  const changed = frame.files.map((f) => `${f.status}:${f.path}`).sort()
  // b.ts modified in the worktree, new.txt + unselected.txt untracked; a.ts clean.
  assert.deepEqual(changed, ['modified:b.ts', 'untracked:new.txt', 'untracked:unselected.txt'])
  assert.match(frame.diff, /changed line/)
  assert.match(frame.diff, /diff --git a\/b.ts/)
  // Untracked new files are folded into the diff, not left as bare paths.
  assert.match(frame.diff, /brand new/)
  assert.match(frame.diff, /not in selection/)
  assert.equal(frame.recentCommitMessage, 'feat: add b.ts')
})

test('paths filter restricts both the file list and the diff', async () => {
  const llm = stubLlm(OK_CHUNKS)
  const deps = depsFor(repo, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
  const res = await runSuggest(deps, DEFAULT_CONFIG, { sessionId: SID, paths: ['new.txt'] })
  assert.equal(res.ok, true)
  const frame = JSON.parse(llm.calls[0].messages[0].content[0].text)
  assert.deepEqual(frame.files, [{ path: 'new.txt', status: 'untracked' }])
  // `git diff HEAD` misses untracked paths; the fold-in supplies their content.
  assert.match(frame.diff, /brand new/)
  assert.doesNotMatch(frame.diff, /changed line/)
  assert.equal(res.ok && res.value.message.length > 0, true)
})

test('unsafe path in the request is rejected', async () => {
  const llm = stubLlm([])
  const deps = depsFor(repo, { getLlm: () => llm })
  const res = await runSuggest(deps, DEFAULT_CONFIG, { sessionId: SID, paths: ['../evil.txt'] })
  assert.equal(res.ok, false)
  if (!res.ok) assert.equal(res.error.code, 'invalid-path')
})

test('unborn repo: diff comes from index + worktree, untracked content folded', async () => {
  const llm = stubLlm(OK_CHUNKS)
  const deps = depsFor(unborn, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
  const res = await runSuggest(deps, DEFAULT_CONFIG, { sessionId: SID })
  assert.equal(res.ok, true)
  const frame = JSON.parse(llm.calls[0].messages[0].content[0].text)
  assert.deepEqual(frame.files, [{ path: 'x.txt', status: 'untracked' }])
  assert.match(frame.diff, /hello/)
})

test('no uncommitted changes reports empty-diff', async () => {
  const clean = mkdtempSync(join(tmpdir(), 'gp-suggest-clean-'))
  try {
    await runGit(clean, ['init', '-q'])
    const llm = stubLlm([])
    const deps = depsFor(clean, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
    const res = await runSuggest(deps, DEFAULT_CONFIG, { sessionId: SID })
    assert.equal(res.ok, false)
    if (!res.ok) assert.equal(res.error.code, 'empty-diff')
    assert.equal(llm.calls.length, 0, 'no model call when there is nothing to summarize')
  } finally {
    rmSync(clean, { recursive: true, force: true })
  }
})

test('oversized diff is truncated and flagged', async () => {
  const llm = stubLlm(OK_CHUNKS)
  const deps = depsFor(repo, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
  const config = { ...DEFAULT_CONFIG, suggestMaxBytes: 64 }
  const res = await runSuggest(deps, config, { sessionId: SID })
  assert.equal(res.ok, true)
  if (res.ok) assert.equal(res.value.truncated, true)
  const frame = JSON.parse(llm.calls[0].messages[0].content[0].text)
  assert.match(frame.diff, /diff truncated/)
  assert.ok(Buffer.byteLength(frame.diff, 'utf8') <= 64 + '\n... [diff truncated]'.length)
})

test('runner stdout-cap truncation is flagged as truncated, not silently dropped', async () => {
  // The diff overruns the runner's per-command stdout cap (profile `maxBytes`
  // below the diff size) while fitting the model-input budget: the suggestion
  // must carry truncated=true, not pass the cut diff off as whole. The cap
  // stays above the workspace-resolution outputs (`rev-parse --show-toplevel`
  // is the longest) so only the diff is lossy.
  const cappedRepo = mkdtempSync(join(tmpdir(), 'gp-suggest-cap-'))
  try {
    await runGit(cappedRepo, ['init', '-q'])
    await runGit(cappedRepo, ['config', 'user.email', 't@t.co'])
    await runGit(cappedRepo, ['config', 'user.name', 'Tester'])
    writeFileSync(join(cappedRepo, 'big.txt'), Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n') + '\n')
    await runGit(cappedRepo, ['add', 'big.txt'])
    await runGit(cappedRepo, ['commit', '-qm', 'feat: add big.txt'])
    // ~2 KB of diff: comfortably over the 512-byte cap below.
    writeFileSync(join(cappedRepo, 'big.txt'), Array.from({ length: 200 }, (_, i) => i < 100 ? `changed ${i}` : `line ${i}`).join('\n') + '\n')
    const llm = stubLlm(OK_CHUNKS)
    const capped = depsFor(cappedRepo, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
    capped.run = createGitRunner(subprocess, DEFAULT_CONFIG.timeoutMs, 512)
    const res = await runSuggest(capped, DEFAULT_CONFIG, { sessionId: SID })
    assert.equal(res.ok, true)
    if (res.ok) assert.equal(res.value.truncated, true)
  } finally {
    rmSync(cappedRepo, { recursive: true, force: true })
  }
})

test('lossy untracked-file diff is flagged as truncated too', async () => {
  // `git diff HEAD` never carries untracked files; their content is folded in
  // by appendUntracked via per-file `--no-index` runs. A lossy runner read
  // there leaves a mid-file prefix — the suggestion must carry truncated=true
  // instead of passing the cut file off as whole (the tracked diff alone is
  // empty, so nothing else flags it).
  const cappedRepo = mkdtempSync(join(tmpdir(), 'gp-suggest-cap-untracked-'))
  try {
    await runGit(cappedRepo, ['init', '-q'])
    await runGit(cappedRepo, ['config', 'user.email', 't@t.co'])
    await runGit(cappedRepo, ['config', 'user.name', 'Tester'])
    await runGit(cappedRepo, ['commit', '--allow-empty', '-qm', 'init: empty'])
    // ~3 KB of new-file content: comfortably over the 512-byte cap below.
    writeFileSync(join(cappedRepo, 'new.txt'), Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n') + '\n')
    const llm = stubLlm(OK_CHUNKS)
    const capped = depsFor(cappedRepo, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
    capped.run = createGitRunner(subprocess, DEFAULT_CONFIG.timeoutMs, 512)
    const res = await runSuggest(capped, DEFAULT_CONFIG, { sessionId: SID })
    assert.equal(res.ok, true)
    if (res.ok) assert.equal(res.value.truncated, true)
  } finally {
    rmSync(cappedRepo, { recursive: true, force: true })
  }
})

test('finish error maps to llm-error with the provider message, even with partial text', async () => {
  // The real chunk envelope is { type:'finish', reason:{ kind, failure } }; a
  // half-streamed message must NOT come back as success (review regression).
  const llm = stubLlm([
    { type: 'text-delta', index: 0, text: 'half a message' },
    { type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: 'quota exceeded' } } },
  ])
  const deps = depsFor(repo, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
  const res = await runSuggest(deps, DEFAULT_CONFIG, { sessionId: SID })
  assert.equal(res.ok, false)
  if (!res.ok) {
    assert.equal(res.error.code, 'llm-error')
    assert.match(res.error.message ?? '', /quota exceeded/)
  }
})

test('aborted finish maps to llm-error', async () => {
  const llm = stubLlm([
    { type: 'text-delta', index: 0, text: 'partial' },
    { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'stream aborted' } } },
  ])
  const deps = depsFor(repo, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
  const res = await runSuggest(deps, DEFAULT_CONFIG, { sessionId: SID })
  assert.equal(res.ok, false)
  if (!res.ok) {
    assert.equal(res.error.code, 'llm-error')
    assert.match(res.error.message ?? '', /stream aborted/)
  }
})

test('max-tokens finish maps to llm-output even when partial text arrived', async () => {
  // Truncated output must not be returned as a complete message (review case).
  const llm = stubLlm([
    { type: 'text-delta', index: 0, text: 'feat: a message cut off mid-sen' },
    { type: 'finish', reason: { kind: 'max-tokens' } },
  ])
  const deps = depsFor(repo, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
  const res = await runSuggest(deps, DEFAULT_CONFIG, { sessionId: SID })
  assert.equal(res.ok, false)
  if (!res.ok) {
    assert.equal(res.error.code, 'llm-output')
    assert.match(res.error.message ?? '', /token limit/)
  }
})

test('empty model output maps to llm-output', async () => {
  const llm = stubLlm([{ type: 'text-delta', index: 0, text: '   ' }, { type: 'finish', reason: { kind: 'stop' } }])
  const deps = depsFor(repo, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
  const res = await runSuggest(deps, DEFAULT_CONFIG, { sessionId: SID })
  assert.equal(res.ok, false)
  if (!res.ok) assert.equal(res.error.code, 'llm-output')
})

test('code-fence wrapper is stripped from the message', async () => {
  const llm = stubLlm([
    { type: 'text-delta', index: 0, text: '```\nfeat: wrapped in fences\n```' },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
  const deps = depsFor(repo, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
  const res = await runSuggest(deps, DEFAULT_CONFIG, { sessionId: SID })
  assert.equal(res.ok, true)
  if (res.ok) assert.equal(res.value.message, 'feat: wrapped in fences')
})

test('suggestEnabled=false refuses at the host gate without calling anything', async () => {
  const llm = stubLlm(OK_CHUNKS)
  const deps = depsFor(repo, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
  const config = { ...DEFAULT_CONFIG, suggestEnabled: false }
  const res = await runSuggest(deps, config, { sessionId: SID })
  assert.equal(res.ok, false)
  if (!res.ok) assert.equal(res.error.code, 'suggest-disabled')
  assert.equal(llm.calls.length, 0)
})

test('missing llm service reports llm-unavailable without calling anything', async () => {
  const deps = depsFor(repo) // no getLlm, no getAgentDefaultModel
  const res = await runSuggest(deps, DEFAULT_CONFIG, { sessionId: SID })
  assert.equal(res.ok, false)
  if (!res.ok) assert.equal(res.error.code, 'llm-unavailable')
})

test('config provider/model override beats the agent default route', async () => {
  const llm = stubLlm(OK_CHUNKS)
  const deps = depsFor(repo, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute('agent-p', 'agent-m') })
  const config = { ...DEFAULT_CONFIG, suggestProvider: 'cfg-p', suggestModel: 'cfg-m' }
  await runSuggest(deps, config, { sessionId: SID })
  assert.equal(llm.calls[0].provider, 'cfg-p')
  assert.equal(llm.calls[0].model, 'cfg-m')
})

test('timeout: a stream that never finishes maps to llm-error', async () => {
  const llm = stubLlm([], { onSignalAbort: true, streamError: new Error('aborted by signal') })
  const deps = depsFor(repo, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
  const config = { ...DEFAULT_CONFIG, suggestTimeoutMs: 60 }
  const res = await runSuggest(deps, config, { sessionId: SID })
  assert.equal(res.ok, false)
  if (!res.ok) {
    assert.equal(res.error.code, 'llm-error')
    assert.match(res.error.message ?? '', /timed out/)
  }
})

test('suggest defaults: 128 KiB diff budget, 4096 output tokens, 15 s timeout', () => {
  // The output default mirrors dsh-base session-title-llm (maxOutputTokens
  // 4096): reasoning a model cannot switch off counts against it.
  assert.equal(DEFAULT_CONFIG.suggestMaxBytes, 128 * 1024)
  assert.equal(DEFAULT_CONFIG.suggestMaxOutputTokens, 4096)
  assert.equal(DEFAULT_CONFIG.suggestTimeoutMs, 15000)
})

test('normalizeConfig clamps suggest limits to their ranges', () => {
  const base = normalizeConfig({})
  assert.equal(base.suggestMaxBytes, 128 * 1024)
  assert.equal(base.suggestMaxOutputTokens, 4096)
  assert.equal(base.suggestTimeoutMs, 15000)
  // Legal but out-of-range values clamp to the boundary (a typed 999999
  // becomes 512 KiB instead of silently falling back to the default).
  assert.equal(normalizeConfig({ suggestMaxBytes: 8 * 1024 }).suggestMaxBytes, 16 * 1024)
  assert.equal(normalizeConfig({ suggestMaxBytes: 4 * 1024 * 1024 }).suggestMaxBytes, 512 * 1024)
  assert.equal(normalizeConfig({ suggestMaxOutputTokens: 10 }).suggestMaxOutputTokens, 256)
  assert.equal(normalizeConfig({ suggestMaxOutputTokens: 999999 }).suggestMaxOutputTokens, 16384)
  assert.equal(normalizeConfig({ suggestTimeoutMs: 100 }).suggestTimeoutMs, 5000)
  assert.equal(normalizeConfig({ suggestTimeoutMs: 9999999 }).suggestTimeoutMs, 120000)
  // Fractional floors; non-numeric falls back to the default.
  assert.equal(normalizeConfig({ suggestMaxOutputTokens: 2048.9 }).suggestMaxOutputTokens, 2048)
  assert.equal(normalizeConfig({ suggestMaxBytes: 'bogus' }).suggestMaxBytes, 128 * 1024)
  assert.equal(normalizeConfig({ suggestTimeoutMs: null }).suggestTimeoutMs, 15000)
  // In-range values pass through untouched.
  const kept = normalizeConfig({ suggestMaxBytes: 64 * 1024, suggestMaxOutputTokens: 1024, suggestTimeoutMs: 30000 })
  assert.equal(kept.suggestMaxBytes, 64 * 1024)
  assert.equal(kept.suggestMaxOutputTokens, 1024)
  assert.equal(kept.suggestTimeoutMs, 30000)
})

test('normalizeConfig unwraps volatile refs for the suggest limits', () => {
  // cordis resolveConfig wraps every .volatile() field in a { get() } ref —
  // the shape rawConfig actually carries in production. Without the unwrap
  // (readBool's unwrapVolatile), a live-edited value silently falls back to
  // the default while the settings form echoes the written value.
  assert.equal(normalizeConfig({ suggestMaxBytes: { get: () => 98304 } }).suggestMaxBytes, 98304)
  assert.equal(normalizeConfig({ suggestMaxOutputTokens: { get: () => 2048 } }).suggestMaxOutputTokens, 2048)
  assert.equal(normalizeConfig({ suggestTimeoutMs: { get: () => 45000 } }).suggestTimeoutMs, 45000)
  // The unwrap runs before the range check: a ref to an out-of-range value
  // clamps to the boundary rather than falling back to the default.
  assert.equal(normalizeConfig({ suggestMaxBytes: { get: () => 4 * 1024 * 1024 } }).suggestMaxBytes, 512 * 1024)
  // A ref yielding a non-number still falls back to the default.
  assert.equal(normalizeConfig({ suggestMaxOutputTokens: { get: () => 'nope' } }).suggestMaxOutputTokens, 4096)
})

test('suggest limit display units divide exactly', () => {
  // The client form derives its display units (KiB / seconds) from these
  // host-unit constants; a non-multiple would make the derived range disagree
  // with what normalizeConfig enforces.
  assert.equal(SUGGEST_LIMITS.maxBytes.min % 1024, 0)
  assert.equal(SUGGEST_LIMITS.maxBytes.max % 1024, 0)
  assert.equal(SUGGEST_LIMITS.timeoutMs.min % 1000, 0)
  assert.equal(SUGGEST_LIMITS.timeoutMs.max % 1000, 0)
})
