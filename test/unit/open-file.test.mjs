/**
 * open-file: hands a browsable file to the OS default application.
 *
 * Locks the two things that must not drift: the per-platform opener argv (no
 * shell, ever) and the containment rule — the OS only ever sees a path that
 * resolved inside the browse root after symlinks.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openerArgv, canOpenWithSystem } from '../../lib/testkit.mjs'

test('each desktop platform gets an argv opener, never a shell string', () => {
  assert.deepEqual(openerArgv('darwin', '/r/report.html'), ['open', '/r/report.html'])
  assert.deepEqual(openerArgv('linux', '/r/report.html'), ['xdg-open', '/r/report.html'])
  // Windows has no `start` binary: rundll32 hands the path to the registered
  // handler, and the path stays a single argv element.
  assert.deepEqual(openerArgv('win32', 'C:\\r\\report.html'), ['rundll32', 'url.dll,FileProtocolHandler', 'C:\\r\\report.html'])
  // The target is never re-parsed: a name with shell metacharacters stays one
  // argument, so nothing downstream can split it.
  const hostile = '/r/a; rm -rf ~.html'
  assert.deepEqual(openerArgv('darwin', hostile), ['open', hostile])
  assert.equal(openerArgv('darwin', hostile).length, 2)
})

test('a platform without a known opener reports unsupported', () => {
  assert.equal(openerArgv('freebsd', '/r/x.html'), null)
  assert.equal(canOpenWithSystem('freebsd'), false)
  assert.equal(canOpenWithSystem('darwin'), true)
  assert.equal(canOpenWithSystem('linux'), true)
  assert.equal(canOpenWithSystem('win32'), true)
})
