/**
 * Release notes are a contract, not free prose: every published body follows
 * `.github/RELEASE_TEMPLATE.md`, and the release workflow reads it from
 * `docs/releases/<tag>.md` instead of retyping it at publish time. This test
 * keeps that file honest — a body missing the English half, the verification
 * section or the compare link is caught here rather than on the release page.
 *
 * The template itself is checked too, so the format source cannot drift away
 * from the shape the notes are validated against.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = new URL('../../', import.meta.url)
const TEMPLATE = fileURLToPath(new URL('.github/RELEASE_TEMPLATE.md', ROOT))
const NOTES_DIR = fileURLToPath(new URL('docs/releases/', ROOT))

/** Headings every body must carry, in both languages. */
const REQUIRED_HEADINGS = ['## 主要变更', '## 安装', '## 验证', '## English', '## Install', '## Verification']

/** The compare link that closes each language half. */
const COMPARE_URL = /https:\/\/github\.com\/xbzbing\/dsh-git-panel\/compare\/\S+/

/** The same link with real tags: the template shows placeholders, notes do not. */
const COMPARE_LINK = /https:\/\/github\.com\/xbzbing\/dsh-git-panel\/compare\/v[0-9.]+\S*v[0-9.]+/

/** `<PREV>...<TAG>` with both tags captured — the rule differs per channel. */
const COMPARE_TAGS = /https:\/\/github\.com\/xbzbing\/dsh-git-panel\/compare\/(v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.\.\.(v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/

/** A tag-shaped notes file name: v<major>.<minor>.<patch>[-prerelease].md */
const NOTES_FILE = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.md$/

/** A pre-release tag carries a `-`: those are never published to npm. */
const PRERELEASE_TAG = /^v\d+\.\d+\.\d+-/

/** `dsh plugin --profile web add @xbzbing/dsh-git-panel@latest`. */
const NPM_INSTALL = /dsh plugin --profile web add @xbzbing\/dsh-git-panel@/

/** A GitHub Release asset URL, capturing the tag it points at. */
const ASSET_INSTALL = /releases\/download\/(v\S+?)\/xbzbing-dsh-git-panel-\S+\.tgz/

test('the release template carries the shape the notes are validated against', () => {
  assert.ok(existsSync(TEMPLATE), '.github/RELEASE_TEMPLATE.md is the format source')
  const template = readFileSync(TEMPLATE, 'utf8')
  for (const heading of REQUIRED_HEADINGS) {
    assert.ok(template.includes(heading), `the template must show ${heading}`)
  }
  assert.match(template, COMPARE_URL, 'the template must show the compare link')
  // Both install channels are documented, together with the rule that a
  // pre-release uses only the asset.
  assert.match(template, NPM_INSTALL, 'the template must show the npm install')
  assert.match(template, /releases\/download\/<TAG>/,'the template must show the asset install')
  assert.match(template, /预发布[^\n]*删掉 npm/, 'the template must say pre-releases drop the npm line')
})

test('every committed release body follows the template', () => {
  const files = existsSync(NOTES_DIR) ? readdirSync(NOTES_DIR).filter((name) => name.endsWith('.md')) : []
  for (const name of files) {
    assert.match(name, NOTES_FILE, `docs/releases/${name} must be named v<major>.<minor>.<patch>.md`)
    const body = readFileSync(new URL(`docs/releases/${name}`, ROOT), 'utf8')
    for (const heading of REQUIRED_HEADINGS) {
      assert.ok(body.includes(heading), `docs/releases/${name} is missing ${heading}`)
    }
    assert.match(body, COMPARE_LINK, `docs/releases/${name} must link the previous tag`)
    const separator = body.indexOf('\n---\n')
    assert.ok(separator > 0, `docs/releases/${name} must separate the Chinese and English halves with ---`)
    assert.ok(body.indexOf('## English') > separator, `docs/releases/${name} must put English after the separator`)

    // The tag this body documents is its file name.
    const tag = name.replace(/\.md$/, '')
    const prerelease = PRERELEASE_TAG.test(tag)

    // Install channels: a pre-release is never on npm, so advertising it would
    // send users to the previous stable version (or a 404). A stable release
    // offers both, and the asset URL always points at its own tag.
    const assets = [...body.matchAll(new RegExp(ASSET_INSTALL, 'g'))].map((m) => m[1])
    assert.ok(assets.length > 0, `docs/releases/${name} must offer the GitHub Release asset`)
    assert.deepEqual([...new Set(assets)], [tag], `docs/releases/${name} must link its own tag's asset`)
    if (prerelease) {
      assert.doesNotMatch(body, NPM_INSTALL, `docs/releases/${name} is a pre-release and must not advertise npm`)
    } else {
      assert.match(body, NPM_INSTALL, `docs/releases/${name} is stable and must offer the npm install`)
    }

    // Changelog baseline: a stable release compares against the previous
    // *stable* tag, so the notes cover everything since users' last stable
    // version — never just the delta from an rc/alpha of the same version.
    for (const match of body.matchAll(new RegExp(COMPARE_TAGS, 'g'))) {
      const [, prev, target] = match
      assert.equal(target, tag, `docs/releases/${name} must compare up to ${tag}`)
      assert.notEqual(prev, tag, `docs/releases/${name} must compare against an earlier tag`)
      if (!prerelease) {
        assert.doesNotMatch(prev, PRERELEASE_TAG, `docs/releases/${name} is stable and must compare against the previous stable tag, not ${prev}`)
      }
    }
  }
})
