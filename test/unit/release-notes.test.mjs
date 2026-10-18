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
const REQUIRED_HEADINGS = ['## 主要变更', '## 验证', '## English', '## Verification']

/** The compare link that closes each language half. */
const COMPARE_URL = /https:\/\/github\.com\/xbzbing\/dsh-git-panel\/compare\/\S+/

/** The same link with real tags: the template shows placeholders, notes do not. */
const COMPARE_LINK = /https:\/\/github\.com\/xbzbing\/dsh-git-panel\/compare\/v[0-9.]+\S*v[0-9.]+/

/** A tag-shaped notes file name: v<major>.<minor>.<patch>[-prerelease].md */
const NOTES_FILE = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.md$/

test('the release template carries the shape the notes are validated against', () => {
  assert.ok(existsSync(TEMPLATE), '.github/RELEASE_TEMPLATE.md is the format source')
  const template = readFileSync(TEMPLATE, 'utf8')
  for (const heading of REQUIRED_HEADINGS) {
    assert.ok(template.includes(heading), `the template must show ${heading}`)
  }
  assert.match(template, COMPARE_URL, 'the template must show the compare link')
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
  }
})
