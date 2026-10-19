/**
 * useViewportTracker: the contract its callers' effect dependency arrays rest
 * on. `elRef` is handed to `CodePreview`'s Ctrl+F interceptor as an effect
 * dependency — that is only free because the ref object is referentially
 * stable across renders, so the effect never re-subscribes. Returning a fresh
 * object per render would turn that dependency into a resubscribe-on-every-
 * render loop, which no existing test would catch.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mount } from './_hook-harness.mjs'
import { useViewportTracker } from '../../lib/hookkit.mjs'

test('elRef keeps one identity across re-renders, so it is safe as an effect dependency', () => {
  const hook = () => useViewportTracker()
  const d = mount(hook)
  const first = d.value.elRef
  d.rerender()
  d.rerender()
  assert.equal(d.value.elRef, first, 'elRef must not be a fresh object per render')
  d.unmount()
})

test('setEl stays referentially stable too (it drives listener re-attachment)', () => {
  const hook = () => useViewportTracker()
  const d = mount(hook)
  const first = d.value.setEl
  d.rerender()
  assert.equal(d.value.setEl, first)
  d.unmount()
})

test('the viewport rect starts zeroed until an element is attached', () => {
  const hook = () => useViewportTracker()
  const d = mount(hook)
  assert.deepEqual(d.value.viewport, { top: 0, height: 0 })
  d.unmount()
})

test('attaching an element adopts its current scroll position and height', () => {
  const el = { scrollTop: 120, clientHeight: 300, addEventListener() {}, removeEventListener() {} }
  const hook = () => useViewportTracker()
  const d = mount(hook)
  d.value.setEl(el)
  d.rerender()
  assert.deepEqual(d.value.viewport, { top: 120, height: 300 })
  assert.equal(d.value.elRef.current, el)
  d.unmount()
})

test('an identical scroll position does not schedule a re-render', () => {
  const el = { scrollTop: 40, clientHeight: 200, addEventListener() {}, removeEventListener() {} }
  const hook = () => useViewportTracker()
  const d = mount(hook)
  d.value.setEl(el)
  d.rerender()
  // Drive the listener path: scrollTop unchanged → the hook returns `prev`, so
  // the shallow-equal state value keeps the slot (and any dependent memo) put.
  let rendered = 0
  const counting = () => { rendered++; return useViewportTracker() }
  const c = mount(counting)
  c.value.setEl(el)
  c.rerender()
  const before = rendered
  c.settle()
  assert.equal(rendered, before, 'no extra render when the rect is unchanged')
  c.unmount()
})
