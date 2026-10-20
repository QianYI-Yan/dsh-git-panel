/**
 * local-origin: decides whether "open in the system browser" is meaningful.
 *
 * The panel may only offer it when the file is on the reader's own disk. The
 * one fact the client can check is the origin of the page it runs in, so this
 * locks the loopback spellings a browser can report and the conservative
 * fallback for everything else.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isLoopbackHostname, canOpenLocally } from '../../lib/testkit.mjs'

test('loopback hostnames are recognised in every spelling a browser reports', () => {
  for (const host of ['127.0.0.1', 'localhost', 'LOCALHOST', '::1', '[::1]', '127.0.0.53', ' 127.0.0.1 ']) {
    assert.equal(isLoopbackHostname(host), true, host)
  }
})

test('anything else is treated as a remote instance', () => {
  for (const host of ['', 'example.com', 'dsh.crazydb.com', 'db.baidu-dev.com', '10.0.0.4', '192.168.1.9',
    // A non-loopback address inside an IPv6 literal, and a lookalike host name.
    '[2001:db8::1]', 'localhost.example.com', '127.0.0.1.example.com']) {
    assert.equal(isLoopbackHostname(host), false, host)
  }
})

test('local open needs both a loopback GUI and a host that can open files', () => {
  assert.equal(canOpenLocally('127.0.0.1'), true)
  assert.equal(canOpenLocally('127.0.0.1', false), false, 'an unsupported host never offers it')
  assert.equal(canOpenLocally('dsh.crazydb.com'), false, 'a remote instance cannot open a local path')
})
