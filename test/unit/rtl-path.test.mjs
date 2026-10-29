/**
 * rtlPathText: the visible text of a path line that elides from the left.
 * An absolute path gets an invisible LRM (U+200E) prefix so the leading '/'
 * is anchored inside the rtl run and the ellipsis swallows it with the rest
 * of the head; anything without a leading '/' reaches the DOM unchanged.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rtlPathText } from '../../lib/testkit.mjs'

const LRM = '\u200e'

test('rtlPathText prefixes an absolute path with an invisible LRM', () => {
  assert.equal(rtlPathText('/Users/a'), LRM + '/Users/a')
  assert.equal(rtlPathText('/Users/a').charCodeAt(0), 0x200e)
  assert.equal(rtlPathText('/'), LRM + '/')
})

test('rtlPathText leaves paths without a leading slash unchanged', () => {
  assert.equal(rtlPathText('Users/a'), 'Users/a')
  assert.equal(rtlPathText('fixture-repo/site'), 'fixture-repo/site')
  assert.equal(rtlPathText(''), '')
})
