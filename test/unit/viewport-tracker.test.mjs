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

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve))

test('an identical scroll position does not schedule a re-render', async () => {
  let rendered = 0
  const counting = () => { rendered++; return useViewportTracker() }
  const c = mount(counting, { autoRender: true })
  let onScroll = null
  const el = {
    scrollTop: 40,
    clientHeight: 200,
    addEventListener(type, fn) { if (type === 'scroll') onScroll = fn },
    removeEventListener() {},
  }
  c.value.setEl(el)
  await flushMicrotasks()
  assert.equal(c.value.viewport.top, 40, 'attach adopts the current scroll position')
  assert.ok(onScroll, 'the tracker registers a scroll listener')
  const before = rendered
  // Unchanged rect → the setter returns `prev`, so the state slot (and any
  // dependent memo) stays put and no render is scheduled.
  onScroll()
  await flushMicrotasks()
  assert.equal(rendered, before, 'no extra render when the rect is unchanged')
  el.scrollTop = 99
  onScroll()
  await flushMicrotasks()
  assert.equal(rendered, before + 1, 'a moved rect schedules exactly one render')
  c.unmount()
})
