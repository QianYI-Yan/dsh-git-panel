/**
 * ADR guardrails: the decision log stays navigable.
 *
 * ADRs are only useful if a reader can find them and trust that every record
 * carries the sections that make it reviewable. Both properties rot silently —
 * a new file that nobody indexed, a record without Consequences — so they are
 * asserted here rather than left to review.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const DIR = fileURLToPath(new URL('../../docs/adr/', import.meta.url))
const README = `${DIR}README.md`

/** `NNNN-kebab-title.md` — the numbering is monotonic and never reused. */
const ADR_FILE = /^(\d{4})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/

/** Sections every record must carry, per the template in README.md. */
const REQUIRED_SECTIONS = ['## Context', '## Decision', '## Consequences']

const FILES = existsSync(DIR)
  ? readdirSync(DIR).filter((name) => ADR_FILE.test(name)).sort()
  : []

test('every ADR is numbered monotonically without gaps or reuse', () => {
  assert.ok(FILES.length > 0, 'docs/adr/ must contain at least one record')
  const numbers = FILES.map((name) => Number(ADR_FILE.exec(name)[1]))
  assert.deepEqual(
    numbers,
    numbers.map((_, index) => index + 1),
    'ADR numbers must run 0001..N with no gap and no duplicate',
  )
})

test('every ADR carries the required sections and a status', () => {
  for (const name of FILES) {
    const body = readFileSync(`${DIR}${name}`, 'utf8')
    for (const section of REQUIRED_SECTIONS) {
      assert.ok(body.includes(section), `docs/adr/${name} is missing ${section}`)
    }
    assert.match(body, /^# ADR-\d{4}：/m, `docs/adr/${name} must open with a numbered title`)
    assert.match(body, /状态：(Accepted|Superseded|Deprecated)/, `docs/adr/${name} must declare a status`)
  }
})

test('the index links every ADR and nothing else', () => {
  const readme = readFileSync(README, 'utf8')
  const linked = [...readme.matchAll(/\]\((\d{4}-[^)]+\.md)\)/g)].map((match) => match[1])
  assert.deepEqual(
    [...new Set(linked)].sort(),
    FILES,
    'the index table must list exactly the records that exist',
  )
  for (const name of FILES) {
    assert.ok(linked.includes(name), `docs/adr/README.md must link ${name}`)
  }
})

test('a superseded ADR points at its replacement', () => {
  for (const name of FILES) {
    const body = readFileSync(`${DIR}${name}`, 'utf8')
    if (!/状态：.*Superseded/.test(body)) continue
    assert.match(
      body,
      /ADR-\d{4}/,
      `docs/adr/${name} is superseded but names no replacement`,
    )
  }
})
