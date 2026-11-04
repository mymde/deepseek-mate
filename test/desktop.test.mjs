import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readlinkSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DesktopOverlay, mountDesktopRoutes, sanitize, extractZip, assetName, isLoopback } from '../lib/desktop.js'
import { BASE } from '../lib/index.js'
import { screenRects } from '../desktop/main.cjs'

function fakeServer() {
  const routes = new Map()
  return { routes, register(r) { routes.set(r.path, r); return () => routes.delete(r.path) } }
}

function call(route, { method = 'GET', headers = {}, body, remote = '127.0.0.1', url = '/' } = {}) {
  return new Promise((resolve) => {
    const listeners = {}
    const req = { method, headers, url, socket: { remoteAddress: remote }, on(ev, fn) { listeners[ev] = fn; return req }, destroy() {} }
    const res = {
      writeHead(code, h = {}) { this.statusCode = code; this.headers = h },
      end(c) { resolve({ status: this.statusCode, body: c ? JSON.parse(c.toString()) : null }) },
    }
    route.handler(req, res)
    queueMicrotask(() => { if (body !== undefined) listeners.data?.(Buffer.from(JSON.stringify(body))); listeners.end?.() })
  })
}

test('sanitize keeps only known message shapes', () => {
  assert.equal(sanitize({ type: 'eval', code: 'x' }), null)
  assert.equal(sanitize({ type: 'debug', op: 'eval' }), null)
  assert.equal(sanitize({ type: 'cmd', method: 'destroy' }), null)
  assert.deepEqual(sanitize({ type: 'cmd', method: 'say', args: ['hi', { expression: 'happy' }, 1, 2] }), { type: 'cmd', method: 'say', args: ['hi', { expression: 'happy' }, 1] })
  const g = sanitize({ type: 'geometry', geometry: { screenX: 10, screenY: 'x', outerWidth: 800, outerHeight: 600, innerWidth: 800, innerHeight: 600, dpr: 2, home: { left: 1, top: 2, width: 3, height: 4, evil: 1 }, hidden: 0 } })
  assert.equal(g.geometry.screenY, 0)
  assert.deepEqual(g.geometry.home, { left: 1, top: 2, width: 3, height: 4 })
  assert.equal(g.geometry.hidden, false)
})

test('screenRects maps the page report to screen rectangles', () => {
  const { win, home } = screenRects({ screenX: 100, screenY: 50, outerWidth: 816, outerHeight: 639, innerWidth: 800, innerHeight: 600, dpr: 1, home: { left: 200, top: 450, width: 400, height: 100 } }, 1)
  assert.deepEqual(win, { left: 108, top: 50, width: 800, height: 639 })
  assert.deepEqual(home, { left: 308, top: 81 + 450, width: 400, height: 100 })
  // Page zoom 125 % on a 1x display: CSS px are larger than DIP.
  const z = screenRects({ screenX: 0, screenY: 0, outerWidth: 1000, outerHeight: 800, innerWidth: 800, innerHeight: 640, dpr: 1.25, home: { left: 100, top: 100, width: 100, height: 50 } }, 1)
  assert.deepEqual(z.home, { left: 125, top: 125, width: 125, height: 62.5 })
})

test('status explains why desktop mode is unavailable', () => {
  const o = new DesktopOverlay({ root: mkdtempSync(join(tmpdir(), 'wm-')) })
  const st = o.status({ socket: { remoteAddress: '203.0.113.9' } })
  assert.equal(st.supported, false)
  assert.ok(['remote', 'no-display', 'platform'].includes(st.reason))
  assert.equal(o.runtime().kind, 'download')
  assert.equal(o.runtime().ready, false)
  assert.ok(isLoopback({ socket: { remoteAddress: '::ffff:127.0.0.1' } }))
  assert.match(assetName('44.10.2', 'win32', 'x64'), /^electron-v44\.10\.2-win32-x64\.zip$/)
  assert.equal(assetName('44.10.2', 'aix', 'ppc64'), null)
})

test('an absent configured Electron executable reports an error instead of silently ignoring start', async () => {
  const overlay = new DesktopOverlay({ config: { electron: '/missing-whale-runtime/electron.exe' } })
  await overlay.start({ download: true })
  assert.equal(overlay.running, false)
  assert.equal(overlay.lastExit.reason, 'error')
  assert.match(overlay.lastExit.message, /可执行文件不存在/)
})

test('desktop routes: auth fence, loopback-only control, message relay', async () => {
  const server = fakeServer()
  const sent = []
  const overlay = { running: true, ready: true, status: () => ({ supported: true }), start: async () => {}, stop() { this.running = false }, send: (m) => sent.push(m) }
  const dispose = mountDesktopRoutes(server, { base: BASE, reject: (req) => (req.headers.cookie ? undefined : 401), overlay })
  const send = server.routes.get(BASE + 'desktop/send')
  assert.equal((await call(send, { method: 'POST', body: {} })).status, 401)
  assert.equal((await call(send, { method: 'POST', headers: { cookie: 'x' }, remote: '198.51.100.7', body: {} })).status, 403)
  assert.equal((await call(send, { method: 'GET', headers: { cookie: 'x' } })).status, 405)
  const r = await call(send, { method: 'POST', headers: { cookie: 'x' }, body: { messages: [{ type: 'cmd', method: 'say', args: ['hi'] }, { type: 'debug', op: 'eval', code: 'boom' }, { type: 'visible', on: 1 }] } })
  assert.equal(r.status, 200)
  assert.equal(r.body.forwarded, 2)
  assert.deepEqual(sent, [{ type: 'cmd', method: 'say', args: ['hi'] }, { type: 'visible', on: true }])
  assert.equal((await call(server.routes.get(BASE + 'desktop/status'), { headers: { cookie: 'x' }, url: BASE + 'desktop/status?since=3' })).status, 200)
  assert.equal((await call(server.routes.get(BASE + 'desktop/stop'), { method: 'POST', headers: { cookie: 'x' }, body: {} })).status, 200)
  assert.equal(overlay.running, false)
  dispose()
  assert.equal(server.routes.size, 0)
})

test('extractZip unpacks files, modes and symlinks, and refuses path escapes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wm-zip-'))
  const make = (name, script) => { execFileSync('python3', ['-I', '-c', script, join(dir, name)]); return join(dir, name) }
  const good = make('good.zip', `
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED)
z.writestr('a/hello.txt', 'hello ' * 100)
i = zipfile.ZipInfo('a/run'); i.external_attr = (0o100755 << 16); i.create_system = 3; z.writestr(i, '#!/bin/sh\\necho hi\\n')
i = zipfile.ZipInfo('a/link'); i.external_attr = (0o120777 << 16); i.create_system = 3; z.writestr(i, 'hello.txt')
z.writestr('a/empty/', '')
z.close()`)
  const out = join(dir, 'out')
  assert.equal(extractZip(good, out), 4)
  assert.equal(readFileSync(join(out, 'a/hello.txt'), 'utf8'), 'hello '.repeat(100))
  if (process.platform !== 'win32') {
    assert.equal(statSync(join(out, 'a/run')).mode & 0o777, 0o755)
    assert.equal(readlinkSync(join(out, 'a/link')), 'hello.txt')
  }
  assert.ok(existsSync(join(out, 'a/empty')))
  const evil = make('evil.zip', `
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1], 'w'); z.writestr('../escape.txt', 'x'); z.close()`)
  assert.throws(() => extractZip(evil, join(dir, 'out2')), /escapes/)
  assert.equal(existsSync(join(dir, 'escape.txt')), false)
  const evilLink = make('evil-link.zip', `
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1], 'w')
i = zipfile.ZipInfo('l'); i.external_attr = (0o120777 << 16); i.create_system = 3; z.writestr(i, '../../etc/passwd')
z.close()`)
  if (process.platform !== 'win32') assert.throws(() => extractZip(evilLink, join(dir, 'out3')), /escapes/)
})
