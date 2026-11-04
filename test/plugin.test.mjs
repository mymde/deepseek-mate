import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { mountRoutes, toolDefinitions, BASE, ACTIONS, EXPRESSIONS, apply } from '../lib/index.js'

function fakeServer() {
  const routes = new Map()
  return { routes, register(r) { routes.set(r.path, r); return () => routes.delete(r.path) } }
}

function call(route, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve) => {
    const chunks = []
    const res = {
      statusCode: 0, headers: {},
      writeHead(code, h = {}) { this.statusCode = code; this.headers = h },
      write(c) { chunks.push(c) }, on() {}, once() {}, emit() {}, removeListener() {},
      end(c) { if (c) chunks.push(c); resolve({ status: this.statusCode, headers: this.headers, size: chunks.reduce((n, c) => n + c.length, 0) }) },
      destroy() { resolve({ status: -1 }) },
    }
    // createReadStream(...).pipe(res) calls write/end on res.
    route.handler({ method, headers }, res)
  })
}

test('serves exactly the bundled files under /whale-mate/, with auth fence', async () => {
  const server = fakeServer()
  const dispose = mountRoutes(server, { reject: (req) => (req.headers.cookie ? undefined : 401) })
  assert.ok(server.routes.has(BASE + 'pet.js'))
  assert.ok(server.routes.has(BASE + 'deepseek-reset.vrm'))
  assert.ok(server.routes.has(BASE + 'thumbs/avatar.png'))
  assert.equal((await call(server.routes.get(BASE + 'pet.js'))).status, 401)
  const ok = await call(server.routes.get(BASE + 'pet.js'), { headers: { cookie: 'x' } })
  assert.equal(ok.status, 200)
  assert.match(ok.headers['Content-Type'], /javascript/)
  assert.equal((await call(server.routes.get(BASE + 'pet.js'), { method: 'POST', headers: { cookie: 'x' } })).status, 405)
  dispose()
  assert.equal(server.routes.size, 0)
})

test('tool definitions: names, enums and no-op execution', async () => {
  const tools = toolDefinitions((d) => d)
  assert.deepEqual(tools.map((t) => t.name), ['pet_say', 'pet_expression', 'pet_action'])
  assert.deepEqual(tools[2].parameters.name.enum, ACTIONS)
  assert.deepEqual(tools[1].parameters.name.enum, EXPRESSIONS)
  for (const t of tools) assert.deepEqual(await t.execute({}), { ok: true })
})

test('apply() can skip tools by config', () => {
  const injected = []
  apply({ inject: (deps) => injected.push(deps.join(',')) }, { tools: false })
  assert.deepEqual(injected, ['webServer,connection'])
})

test('client module registers a cordis plugin with the package id', () => {
  let loaded
  const sandbox = { window: { __ModuleLoader__: { load: (m) => { loaded = m } } }, console, URL, document: { baseURI: 'http://x/' } }
  vm.runInNewContext(readFileSync(new URL('../client/client.js', import.meta.url), 'utf8'), sandbox)
  assert.equal(loaded.id, 'dsh-plugin-whale-mate')
  const plugin = loaded.factory((name) => { if (name === 'react') return { createElement: () => null, useState: () => [0, () => {}], useSyncExternalStore: (s, g) => g() }; throw new Error(name) })
  assert.deepEqual([...plugin.inject], ['slots', 'sessions'])
  assert.equal(typeof plugin.apply, 'function')
})

test('model route serves the configured avatar, falling back to the bundled one', async () => {
  const { resolveModel, DEFAULT_MODEL } = await import('../lib/index.js')
  const warnings = []
  assert.equal(resolveModel({}, {}).path, DEFAULT_MODEL)
  assert.match(resolveModel({ model: 'deepseek-reset' }, {}).path, /deepseek-reset\.vrm$/)
  assert.equal(resolveModel({ model: 'relative.vrm' }, {}, (m) => warnings.push(m)).path, DEFAULT_MODEL)
  assert.equal(resolveModel({ model: '/nope/missing.vrm' }, {}, (m) => warnings.push(m)).path, DEFAULT_MODEL)
  assert.equal(warnings.length, 2)
  const custom = resolveModel({ model: DEFAULT_MODEL, modelName: '测试' }, {})
  assert.deepEqual([custom.custom, custom.name], [true, '测试'])
  assert.equal(resolveModel({}, { DSH_WHALE_MATE_MODEL: DEFAULT_MODEL }).custom, true)
  const server = fakeServer()
  mountRoutes(server, { model: custom })
  const vrm = await call(server.routes.get(BASE + 'model.vrm'))
  assert.equal(vrm.status, 200)
  assert.equal(vrm.headers['Content-Type'], 'model/gltf-binary')
  assert.ok(vrm.size > 1e6)
  assert.equal((await call(server.routes.get(BASE + 'model.json'))).status, 200)
})
