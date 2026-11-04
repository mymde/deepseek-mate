import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { modelChoices, modelPathFor, resolveModel, PUBLIC_DIR } from '../lib/index.js'
import { mountDesktopRoutes } from '../lib/desktop.js'

test('Settings offers the bundled avatars with thumbnails and marks the configured one', () => {
  const resolved = resolveModel({})
  const list = modelChoices(resolved)
  assert.deepEqual(list.map((m) => m.id), ['deepseek-reset'])
  assert.ok(list.every((m) => m.thumb && m.file.endsWith('.vrm')))
  assert.equal(list.filter((m) => m.configured).length, 1)
  assert.match(list[0].credit, /hihihihi202/)
  assert.equal(modelPathFor('deepseek-reset', resolved), join(PUBLIC_DIR, 'deepseek-reset.vrm'))
  assert.equal(modelPathFor('whale-maid', resolved), null)
  assert.equal(modelPathFor('../etc/passwd', resolved), null)
  assert.equal(modelPathFor('custom', resolved), null)
})

test('desktop start takes the avatar picked in Settings (ids only, never paths)', async () => {
  const routes = new Map()
  const server = { register(r) { routes.set(r.path, r); return () => routes.delete(r.path) } }
  const started = []
  const overlay = { start: async (o) => { started.push(o) }, status: () => ({ supported: true }), stop() {} }
  mountDesktopRoutes(server, { base: '/whale-mate/', reject: () => null, overlay, modelPath: (id) => (id === 'whale-maid' ? '/m/whale-maid.vrm' : null) })
  const post = (body) => new Promise((resolve) => {
    const listeners = {}
    const req = { method: 'POST', headers: { 'content-type': 'application/json' }, url: '/', socket: { remoteAddress: '127.0.0.1' }, on(ev, fn) { listeners[ev] = fn; return req }, destroy() {} }
    const res = { writeHead(c) { this.status = c }, end() { resolve(this.status) } }
    routes.get('/whale-mate/desktop/start').handler(req, res)
    queueMicrotask(() => { listeners.data?.(Buffer.from(JSON.stringify(body))); listeners.end?.() })
  })
  assert.equal(await post({ size: 360, model: 'whale-maid' }), 200)
  assert.equal(await post({ size: 360, model: '/etc/passwd' }), 200)
  assert.equal(started[0].modelPath, '/m/whale-maid.vrm')
  assert.equal(started[1].modelPath, undefined)
})
