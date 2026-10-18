/**
 * splitMermaidSegments: the rendered-Markdown segment splitter that decides
 * which parts of a document go to the official MarkdownText and which go to
 * the lazy mermaid chunk. Locks the CommonMark-subset fence contract —
 * top-level mermaid fences only, non-mermaid fences pass through verbatim,
 * an unclosed fence runs to end of input, and a document without mermaid is
 * a single verbatim segment (the zero-behavior-change path).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitMermaidSegments, markdownKbdToCode } from '../../lib/testkit.mjs'

test('a document without mermaid is one verbatim markdown segment', () => {
  const source = '# Title\n\n```js\nconst x = 1\n```\n\ntail\n'
  assert.deepEqual(splitMermaidSegments(source), [{ kind: 'markdown', text: source }])
})

test('a mermaid fence splits markdown around it in document order', () => {
  const segments = splitMermaidSegments('Intro\n\n```mermaid\ngraph TD; A-->B\n```\n\nOutro\n')
  assert.deepEqual(segments, [
    { kind: 'markdown', text: 'Intro\n' },
    { kind: 'mermaid', source: 'graph TD; A-->B' },
    { kind: 'markdown', text: '\nOutro\n' },
  ])
})

test('tilde fences and case-insensitive info strings open mermaid segments', () => {
  const segments = splitMermaidSegments('~~~Mermaid\nsequenceDiagram\n~~~\n')
  assert.deepEqual(segments, [{ kind: 'mermaid', source: 'sequenceDiagram' }])
})

test('a longer opening fence closes only at a fence of at least its length', () => {
  const segments = splitMermaidSegments('````mermaid\ngraph TD; A["```"] --> B\n````\n')
  assert.equal(segments.length, 1)
  assert.equal(segments[0].kind, 'mermaid')
  assert.ok(segments[0].source.includes('"```"'), 'an inner shorter fence stays inside the diagram source')
})

test('non-mermaid fences pass through even when they mention mermaid', () => {
  const source = '```markdown\nexample:\n\n```mermaid\ngraph TD\n```\n```\n\ntail\n'
  assert.deepEqual(splitMermaidSegments(source), [{ kind: 'markdown', text: source }])
})

test('an unclosed mermaid fence runs to end of input', () => {
  const segments = splitMermaidSegments('before\n\n```mermaid\ngraph TD; A-->B\n')
  assert.equal(segments.length, 2)
  assert.deepEqual(segments[1], { kind: 'mermaid', source: 'graph TD; A-->B\n' })
})

test('a fence indented past three spaces stays inside the markdown segment', () => {
  const source = '- item:\n\n    ```mermaid\n    graph TD\n    ```\n'
  assert.deepEqual(splitMermaidSegments(source), [{ kind: 'markdown', text: source }])
})

test('a document that is only a mermaid fence has no markdown segments', () => {
  const segments = splitMermaidSegments('```mermaid\ngraph LR; X-->Y\n```\n')
  assert.deepEqual(segments, [{ kind: 'mermaid', source: 'graph LR; X-->Y' }])
})

test('multiple mermaid fences alternate with their markdown', () => {
  const segments = splitMermaidSegments('```mermaid\nA\n```\nmiddle\n```mermaid\nB\n```\n')
  assert.equal(segments.length, 3)
  assert.equal(segments[0].kind, 'mermaid')
  assert.deepEqual(segments[1], { kind: 'markdown', text: 'middle' })
  assert.equal(segments[2].kind, 'mermaid')
})

test('kbd hints in prose become inline code', () => {
  assert.equal(
    markdownKbdToCode('press <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>F</kbd> to find'),
    'press `Ctrl`/`⌘`+`F` to find',
  )
})

test('kbd replacement is case-insensitive', () => {
  assert.equal(markdownKbdToCode('<KBD>Esc</KBD> closes'), '`Esc` closes')
})

test('kbd inside fenced code and inline code stays literal', () => {
  const fenced = '```md\nexample: <kbd>Ctrl</kbd>\n```\nprose <kbd>Ctrl</kbd>\n'
  assert.equal(
    markdownKbdToCode(fenced),
    '```md\nexample: <kbd>Ctrl</kbd>\n```\nprose `Ctrl`\n',
  )
  assert.equal(markdownKbdToCode('write `<kbd>x</kbd>` literally'), 'write `<kbd>x</kbd>` literally')
})

test('kbd content containing backticks stays well-formed', () => {
  // Unpaired backticks get a CommonMark double-backtick span around the body…
  assert.equal(markdownKbdToCode('run <kbd>x`y</kbd> now'), 'run ``x`y`` now')
  // …while content that is itself a complete inline-code span keeps the
  // literal markup (inline-code masking wins — never a partial rewrite).
  assert.equal(markdownKbdToCode('edge <kbd>`tick`</kbd>'), 'edge <kbd>`tick`</kbd>')
})

test('CRLF documents split mermaid fences', () => {
  const crlf = 'Intro\r\n\r\n```mermaid\r\ngraph TD; A-->B\r\n```\r\n'
  const segments = splitMermaidSegments(crlf)
  assert.equal(segments.length, 2)
  assert.equal(segments[0].kind, 'markdown')
  assert.deepEqual(segments[1], { kind: 'mermaid', source: 'graph TD; A-->B\r' })
})

test('CRLF fences still protect literal kbd examples', () => {
  const fenced = '```md\r\npress <kbd>Ctrl</kbd>\r\n```\r\nprose <kbd>Ctrl</kbd>\r\n'
  assert.equal(
    markdownKbdToCode(fenced),
    '```md\r\npress <kbd>Ctrl</kbd>\r\n```\r\nprose `Ctrl`\r\n',
  )
})
