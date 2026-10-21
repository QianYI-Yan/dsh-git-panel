/**
 * The rendered HTML preview's state machine, driven through a minimal React
 * runtime (_hook-harness).
 *
 * Node has no DOMParser, so `packHtmlDocument` always falls back to the plain
 * bytes: these tests cover the plain path, the state transitions and the object
 * URL lifecycle. Real asset parsing, real packing and delayed RPC races are
 * browser behaviour and are locked in test/e2e/html-preview-lifecycle.mjs.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mount } from './_hook-harness.mjs'
import { useHtmlPreview } from '../../lib/hookkit.mjs'

const require = createRequire(import.meta.url)
const React = require('react')

/** A text file as the preview sees it; a fresh object models a re-read. */
const file = (content, path = 'page.html') => ({ kind: 'text', path, content, lines: 1 })

/** Heavy enough to require the confirmation: one inline script past 512 KiB. */
const heavy = (path = 'heavy.html') => file(`<p>hi</p><script>${'x'.repeat(600 * 1024)}</script>`, path)

/**
 * Mount the hook under a controlled parent. `onRenderChange` is a real state
 * setter — a spy that left `renderMarkdown` stale would not model the page.
 */
function mountPreview(initial) {
  const ctx = {
    file: initial.file ?? null,
    renderMarkdown: initial.renderMarkdown ?? false,
    remote: initial.remote ?? { query: async (req) => ({ ok: true, value: { kind: req.query.kind, variant: 'text', content: 'asset' } }) },
    sessionId: 'sess',
    t: (key) => key,
    calls: [],
    queryCalls: [],
    html: null,
    setRender: null,
  }
  const remote = {
    openFile: async (req) => { ctx.openCalls = [...(ctx.openCalls ?? []), req]; return ctx.openResult ?? { ok: true } },
    query: async (req) => { ctx.queryCalls.push(req.query); return ctx.remote.query(req) },
  }
  const h = mount(() => {
    const [renderMarkdown, setRenderMarkdown] = React.useState(ctx.renderMarkdown)
    ctx.renderMarkdown = renderMarkdown
    // The dispatcher's setter is stable across renders, so the callback the
    // hook receives keeps one identity, like the page's own setState.
    if (ctx.setRender === null) {
      ctx.setRender = setRenderMarkdown
      ctx.onRenderChange = (value) => { ctx.calls.push(value); setRenderMarkdown(value) }
    }
    ctx.html = useHtmlPreview({
      file: ctx.file,
      renderMarkdown,
      onRenderChange: ctx.onRenderChange,
      remote,
      sessionId: ctx.sessionId,
      t: ctx.t,
    })
    return ctx.html
  })
  return { h, ctx }
}

/** Object-URL ledger: the hook's blobs are recorded instead of created. */
function trackUrls(t) {
  const created = []
  const revoked = []
  const realCreate = URL.createObjectURL
  const realRevoke = URL.revokeObjectURL
  URL.createObjectURL = (blob) => {
    const url = `blob:test/${created.length}`
    created.push({ url, blob })
    return url
  }
  URL.revokeObjectURL = (url) => { revoked.push(url) }
  t.after(() => { URL.createObjectURL = realCreate; URL.revokeObjectURL = realRevoke })
  return { created, revoked }
}

test('a rendered HTML page holds the source preview until its pack settles', async (t) => {
  const { created } = trackUrls(t)
  const { h, ctx } = mountPreview({ file: file('<p>hi</p>'), renderMarkdown: true })
  // First render: the pack has not settled, so no frame may exist yet.
  assert.equal(h.value.frame, null, 'a pending pack reports null (hold the source preview)')
  await h.settle()
  assert.equal(h.value.mode, 'interactive', 'scripts are on by default')
  assert.equal(h.value.frame?.kind, 'interactive', 'the settled document is an interactive frame')
  assert.ok(h.value.frame.src.startsWith('blob:'), 'the interactive frame travels through a blob: URL')
  assert.equal(created.length, 1, 'exactly one document is handed to the frame')
  const body = await created[0].blob.text()
  assert.ok(body.includes('<p>hi</p>'), 'the frame carries the document bytes')
  assert.ok(body.includes('dsh-html-ready'), 'the document carries the ready report')
  // No DOMParser in Node: the packer falls back to the plain bytes without a
  // single asset read.
  assert.deepEqual(ctx.queryCalls, [], 'the plain fallback reads no assets')
})

test('the source and static views create no document at all', async (t) => {
  const { created, revoked } = trackUrls(t)
  const { h, ctx } = mountPreview({ file: file('<p>hi</p>'), renderMarkdown: false })
  await h.settle()
  assert.equal(h.value.frame, undefined, 'the source view has no frame')
  assert.equal(created.length, 0, 'the source view creates no object URL')
  assert.deepEqual(ctx.queryCalls, [], 'selecting an HTML page reads no assets')

  // Rendering, then turning scripts off: the interactive document is released
  // and the static preview takes over.
  ctx.setRender(true)
  await h.settle()
  const interactive = h.value.frame
  assert.equal(interactive?.kind, 'interactive', 'the rendered view is interactive')
  h.value.toggleScripts()
  await h.settle()
  assert.equal(h.value.mode, 'static', 'the JS toggle switches the mode')
  assert.equal(h.value.frame?.kind, 'static', 'the static view is a srcdoc document')
  assert.ok(h.value.frame.srcdoc.includes('Content-Security-Policy'), 'the static document blocks the network')
  assert.equal(h.value.stop, undefined, 'a static preview has no wait to stop')
  assert.deepEqual(revoked, [interactive.src], 'turning scripts off releases the interactive document')
})

test('a heavy document asks first, and approval belongs to the loaded object', async (t) => {
  trackUrls(t)
  const { h, ctx } = mountPreview({ file: heavy(), renderMarkdown: true })
  await h.settle()
  assert.notEqual(h.value.heavy, null, 'a heavy document asks before it renders')
  assert.equal(h.value.heavy.bytes >= 512 * 1024, true, 'the question carries the script weight')
  assert.equal(h.value.frame, undefined, 'no frame is mounted while the question is open')

  h.value.heavy.approve()
  await h.settle()
  assert.equal(h.value.heavy, null, 'approving closes the question')
  assert.equal(h.value.frame?.kind, 'interactive', 'the approved document is rendered')

  // A manual refresh re-reads the same path into a NEW object without resetting:
  // the approval and the script preference survive.
  ctx.file = heavy()
  h.rerender()
  await h.settle()
  assert.equal(h.value.heavy, null, 'a re-read of the same path does not ask again')
  assert.equal(h.value.frame?.kind, 'interactive', 'the re-read is rendered')
})

test('a fresh selection resets the approval, the stopped render and scripts', async (t) => {
  trackUrls(t)
  const { h, ctx } = mountPreview({ file: heavy(), renderMarkdown: true })
  await h.settle()
  h.value.heavy.approve()
  await h.settle()
  assert.equal(h.value.frame?.kind, 'interactive', 'the approved document is rendered')

  h.value.toggleScripts()
  await h.settle()
  assert.equal(h.value.mode, 'static', 'scripts are off')

  // Selecting the same path again is a fresh selection, not a refresh.
  h.value.resetForSelection()
  await h.settle()
  assert.equal(h.value.mode, 'interactive', 'a fresh selection restores the default script permission')
  assert.notEqual(h.value.heavy, null, 'a fresh selection asks about the heavy document again')
  assert.equal(h.value.frame, undefined, 'nothing is mounted while the question is open')
})

test('stopping returns to the source view and the next render retries', async (t) => {
  trackUrls(t)
  const { h, ctx } = mountPreview({ file: heavy(), renderMarkdown: true })
  await h.settle()
  h.value.heavy.approve()
  await h.settle()
  const approved = h.value.frame
  assert.equal(approved?.kind, 'interactive', 'the approved document is rendered')
  assert.equal(typeof h.value.stop, 'function', 'the interactive frame can be stopped')

  h.value.stop()
  await h.settle()
  assert.deepEqual(ctx.calls, [false], 'stopping leaves the rendered view')
  assert.equal(ctx.renderMarkdown, false, 'the parent switched to the source view')
  assert.equal(h.value.frame, undefined, 'the frame is unmounted')

  // Coming back to the rendered view retries without asking again: the stop did
  // not revoke the approval, and that is the existing behaviour.
  h.value.changeView(true)
  await h.settle()
  assert.deepEqual(ctx.calls, [false, true], 'the switcher drives the parent view')
  assert.equal(h.value.heavy, null, 'a stopped-then-retried render keeps its approval')
  assert.equal(h.value.frame?.kind, 'interactive', 'the retried render mounts a frame again')
})

test('the static hint only appears for a page that renders through its scripts', async (t) => {
  trackUrls(t)
  // Little authored text plus a script: the static preview would look broken.
  const { h } = mountPreview({ file: file('<div id="app"></div><script>start()</script>'), renderMarkdown: true })
  await h.settle()
  h.value.toggleScripts()
  await h.settle()
  assert.equal(h.value.frame?.kind, 'static', 'the static preview is shown')
  assert.equal(typeof h.value.hint?.run, 'function', 'the hint offers the way back to a running page')
  h.value.hint.run()
  await h.settle()
  assert.equal(h.value.mode, 'interactive', 'running the page restores scripts')
  assert.equal(h.value.hint, undefined, 'the hint disappears once the page can run')

  // A page with real copy needs no warning.
  const plain = mountPreview({ file: file(`<p>${'word '.repeat(60)}</p><script>x()</script>`), renderMarkdown: true })
  await plain.h.settle()
  plain.h.value.toggleScripts()
  await plain.h.settle()
  assert.equal(plain.h.value.hint, undefined, 'a page with visible copy needs no hint')
})

test('opening in the system browser leaves the source view, or reports why not', async (t) => {
  trackUrls(t)
  const { h, ctx } = mountPreview({ file: heavy(), renderMarkdown: true })
  await h.settle()
  assert.equal(h.value.heavy.canOpen, false, 'a non-loopback GUI offers no local open')
  ctx.openResult = { ok: false, error: { code: 'git-error', message: 'no opener' } }
  await h.value.heavy.openExternally()
  await h.settle()
  assert.equal(h.value.heavy.error, 'files.htmlOpenFailed', 'a refused open keeps the question and names the failure')
  assert.deepEqual(ctx.calls, [], 'a refused open does not change the view')

  ctx.openResult = { ok: true }
  await h.value.heavy.openExternally()
  await h.settle()
  assert.deepEqual(ctx.calls, [false], 'a successful open leaves the rendered view')
  assert.equal(h.value.heavy, null, 'the page now lives outside the panel')
})

test('a loopback GUI offers the local escape', async (t) => {
  trackUrls(t)
  const realLocation = globalThis.location
  globalThis.location = { hostname: '127.0.0.1' }
  t.after(() => { if (realLocation === undefined) delete globalThis.location; else globalThis.location = realLocation })
  const { h } = mountPreview({ file: heavy(), renderMarkdown: true })
  await h.settle()
  assert.equal(h.value.heavy.canOpen, true, 'a loopback GUI shares the disk with the file')
})

test('unmounting releases the document the frame was built from', async (t) => {
  const { created, revoked } = trackUrls(t)
  const { h } = mountPreview({ file: file('<p>hi</p>'), renderMarkdown: true })
  await h.settle()
  assert.equal(created.length, 1, 'one document was handed to the frame')
  h.unmount()
  assert.deepEqual(revoked, [created[0].url], 'unmounting revokes the object URL')
})
