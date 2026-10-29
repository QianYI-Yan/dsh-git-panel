/**
 * Full-screen request failure classification: every way the toggle can fail
 * maps to the notice key that names its reason, so the control is never dead
 * and silent. A Permissions-Policy lockout surfaces as a TypeError from the
 * request; everything else falls back to the generic refusal.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { screenFailKeyOf, SCREEN_TIMEOUT_MS } from '../../lib/testkit.mjs'

test('a TypeError is a Permissions-Policy lockout', () => {
  assert.equal(screenFailKeyOf(new TypeError('permissions policy')), 'files.screenFullBlocked')
})

test('a plain rejection falls back to the generic refusal', () => {
  assert.equal(screenFailKeyOf(new Error('denied')), 'files.screenFullRefused')
})

test('a non-Error rejection value still resolves to a notice key', () => {
  assert.equal(screenFailKeyOf('denied'), 'files.screenFullRefused')
  assert.equal(screenFailKeyOf(undefined), 'files.screenFullRefused')
  assert.equal(screenFailKeyOf(null), 'files.screenFullRefused')
})

test('every failure maps to a screenFull* notice key', () => {
  for (const err of [new TypeError('x'), new Error('y'), new DOMException('z', 'NotAllowedError'), undefined]) {
    assert.match(screenFailKeyOf(err), /^files\.screenFull/)
  }
})

test('the watchdog tolerance is positive and finite', () => {
  assert.ok(Number.isFinite(SCREEN_TIMEOUT_MS) && SCREEN_TIMEOUT_MS > 0)
})
