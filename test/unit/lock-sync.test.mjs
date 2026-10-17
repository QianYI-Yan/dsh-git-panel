/**
 * package-lock.json must stay in sync with package.json.
 *
 * The lock is committed and CI installs with `npm ci`, which refuses to run
 * whenever the manifest and the lock disagree. That drift already happened
 * once: the lock sat at 0.3.0 through seven releases, because the release
 * commits bumped package.json alone, and npm ci then failed on the peer that
 * was added in the meantime. Bump with `npm version <v> --no-git-tag-version`,
 * which updates the manifest and both lock version fields together.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'))
const root = lock.packages?.['']

// npm mirrors these manifest fields into the lock's root entry; one of them
// missing means the lock predates that field (or was hand-edited).
const MIRRORED = [
  'name',
  'version',
  'license',
  'engines',
  'devDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
]

test('lockfile version and root entry exist', () => {
  assert.equal(lock.lockfileVersion, 3, 'package-lock.json must stay at lockfileVersion 3')
  assert.ok(root, 'package-lock.json has no root ("") entry')
})

test('lock root mirrors the manifest', () => {
  for (const field of MIRRORED) {
    if (manifest[field] === undefined) continue
    assert.deepEqual(
      root[field],
      manifest[field],
      `package-lock.json root.${field} must match package.json — run \`npm install --package-lock-only\``,
    )
  }
})

test('lock version fields match the manifest version', () => {
  assert.equal(lock.version, manifest.version, 'package-lock.json top-level version is stale')
  assert.equal(root.version, manifest.version, 'package-lock.json root version is stale')
})
