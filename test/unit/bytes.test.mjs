/**
 * formatBytes: 1024-based human size for the file-properties dialog. Whole
 * bytes below 1 KiB keep their exact value (no false precision); larger sizes
 * show one decimal, stepping up when the exact value passes the unit or the
 * one-decimal display would round to 1024.0 (except at the TB ceiling).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatBytes } from '../../lib/testkit.mjs'

test('formatBytes keeps sub-KiB values as exact bytes', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(1), '1 B')
  assert.equal(formatBytes(1023), '1023 B')
})

test('formatBytes steps up units at 1024 boundaries', () => {
  assert.equal(formatBytes(1024), '1.0 KB')
  assert.equal(formatBytes(1536), '1.5 KB')
  assert.equal(formatBytes(1024 * 1024), '1.0 MB')
  assert.equal(formatBytes(1024 * 1024 * 1024), '1.0 GB')
  assert.equal(formatBytes(1024 * 1024 * 1024 * 1024), '1.0 TB')
})

test('formatBytes never displays a rounded 1024.0 below the TB ceiling', () => {
  // A value one byte under a unit boundary rounds to 1024.0 at one decimal,
  // so it steps up instead of reading "1024.0 KB"/"1024.0 MB".
  assert.equal(formatBytes(1024 * 1024 - 1), '1.0 MB')
  assert.equal(formatBytes(1024 * 1024 * 1024 - 1), '1.0 GB')
})

test('formatBytes stops at TB and rejects invalid input', () => {
  // Beyond TB it stays at TB rather than inventing a PB unit the UI never shows.
  assert.equal(formatBytes(1024 * 1024 * 1024 * 1024 * 1024), '1024.0 TB')
  assert.equal(formatBytes(-1), '')
  assert.equal(formatBytes(NaN), '')
  assert.equal(formatBytes(Infinity), '')
})
