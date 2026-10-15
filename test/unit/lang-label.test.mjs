/**
 * langLabel: display spelling for the platform's shiki-style language ids.
 * The properties dialog's type row shows this verbatim, so the conventional
 * branding (TypeScript, not Typescript) is a user-facing contract.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { langLabel } from '../../lib/testkit.mjs'

test('langLabel uses conventional branding for known ids', () => {
  assert.equal(langLabel('typescript'), 'TypeScript')
  assert.equal(langLabel('javascript'), 'JavaScript')
  assert.equal(langLabel('jsx'), 'JSX')
  assert.equal(langLabel('tsx'), 'TSX')
  assert.equal(langLabel('cpp'), 'C++')
  assert.equal(langLabel('csharp'), 'C#')
  assert.equal(langLabel('css'), 'CSS')
  assert.equal(langLabel('html'), 'HTML')
})

test('langLabel falls back to first-letter capitalization', () => {
  assert.equal(langLabel('abap'), 'Abap')
  assert.equal(langLabel('zig'), 'Zig')
})
