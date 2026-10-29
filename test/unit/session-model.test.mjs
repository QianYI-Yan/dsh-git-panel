/**
 * The session model route is read per request: a projection service that comes
 * up (or is replaced) after the plugin activated must be the one consulted.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sessionModelReader } from '../../lib/host/session-model.js'

const session = { id: 's1' }
const projectionsWith = (next) => ({ snapshot: (s, keys) => (s === session && keys?.[0] === 'modelSelection' ? { values: { modelSelection: { next } } } : { values: {} }) })

test('projections registered after the reader was built are read', () => {
  const services = new Map([['sessions', { get: (id) => (id === 's1' ? session : undefined) }]])
  const read = sessionModelReader((key) => services.get(key))
  assert.equal(read('s1'), undefined, 'no projection service yet: no session route')
  services.set('sessionProjections', projectionsWith({ provider: 'p', model: 'm', reasoningEffort: 'high' }))
  assert.deepEqual(read('s1'), { provider: 'p', model: 'm', reasoningEffort: 'high' }, 'the late service is picked up')
  services.set('sessionProjections', projectionsWith({ provider: 'p2', model: 'm2' }))
  assert.deepEqual(read('s1'), { provider: 'p2', model: 'm2' }, 'a restarted service replaces the old one')
})

test('an unknown session, a throwing projection or an incomplete pair yields no route', () => {
  const services = new Map([['sessions', { get: (id) => (id === 's1' ? session : undefined) }]])
  const read = sessionModelReader((key) => services.get(key))
  services.set('sessionProjections', projectionsWith({ provider: 'p', model: 'm' }))
  assert.equal(read('nope'), undefined)
  services.set('sessionProjections', { snapshot: () => { throw new Error('disposed') } })
  assert.equal(read('s1'), undefined)
  services.set('sessionProjections', projectionsWith({ provider: 'p', model: '' }))
  assert.equal(read('s1'), undefined)
  services.set('sessionProjections', projectionsWith(null))
  assert.equal(read('s1'), undefined)
  services.set('sessionProjections', projectionsWith({ provider: 'p', model: 'm', reasoningEffort: '' }))
  assert.deepEqual(read('s1'), { provider: 'p', model: 'm' }, 'a blank effort is left out')
})
