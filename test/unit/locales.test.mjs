/**
 * The `gitPanel` dictionaries: every locale DSH ships carries the full key set
 * of the English baseline, with the same `{placeholders}` and no empty text.
 * The platform falls back to English per key, so a gap would not show a raw
 * key — but it would silently mix languages, which only this test catches.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DICTIONARIES } from '../../lib/testkit.mjs'

const placeholders = (text) => (text.match(/\{\w+\}/g) ?? []).sort().join(',')

test('the namespace registers every language DSH ships', () => {
  assert.deepEqual(Object.keys(DICTIONARIES), ['zh', 'en', 'ja', 'es', 'fr', 'de', 'ru', 'pt'])
})

test('every dictionary carries exactly the English key set', () => {
  const keys = Object.keys(DICTIONARIES.en)
  for (const [id, dict] of Object.entries(DICTIONARIES)) {
    assert.deepEqual(Object.keys(dict).filter((k) => !(k in DICTIONARIES.en)), [], `${id}: no extra keys`)
    assert.deepEqual(keys.filter((k) => !(k in dict)), [], `${id}: no missing keys`)
  }
})

test('every translation keeps the placeholders and says something', () => {
  for (const [id, dict] of Object.entries(DICTIONARIES)) {
    for (const [key, source] of Object.entries(DICTIONARIES.en)) {
      assert.equal(placeholders(dict[key]), placeholders(source), `${id} ${key}: placeholders`)
      if (source !== '') assert.notEqual(dict[key].trim(), '', `${id} ${key}: empty text`)
    }
  }
})
