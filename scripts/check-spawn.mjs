// Regression for the official Host's Electron RunAsNode -> independent overlay process boundary.
import { DesktopOverlay } from '../lib/desktop.js'
import { resolveModel } from '../lib/index.js'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const electron = process.argv[2]
if (!electron) throw new Error('Pass an Electron executable')
process.env.ELECTRON_RUN_AS_NODE = '1'
process.env.WHALE_MATE_DEBUG = '1'
const root = mkdtempSync(join(tmpdir(), 'whale-spawn-'))
const overlay = new DesktopOverlay({ config: { electron }, root, modelPath: resolveModel().path })
const pending = new Map()
let id = 0
overlay.onDebug = (m) => {
  pending.get(m.id)?.(m)
  pending.delete(m.id)
}
const debug = (op, code) =>
  new Promise((resolve, reject) => {
    const key = ++id
    const timer = setTimeout(() => {
      pending.delete(key)
      reject(new Error('debug timeout'))
    }, 10000)
    pending.set(key, (m) => {
      clearTimeout(timer)
      m.error ? reject(new Error(m.error)) : resolve(m)
    })
    overlay.send({ type: 'debug', op, code, id: key })
  })
const delay = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (fn) => {
  for (let i = 0; i < 150; i++) {
    if (await fn()) return
    await delay(100)
  }
  throw new Error('timeout waiting for overlay')
}
const geometry = {
  screenX: 200,
  screenY: 300,
  outerWidth: 1000,
  outerHeight: 550,
  innerWidth: 1000,
  innerHeight: 550,
  dpr: 1,
  hidden: false
}
try {
  await overlay.start({ size: 220 })
  await until(() => overlay.ready || overlay.lastExit)
  assert.equal(overlay.ready, true, JSON.stringify(overlay.lastExit))
  console.log('PASS independent Electron launches despite inherited RunAsNode')
  assert.equal((await debug('eval', '__whaleMate.state().motions.clips.length')).value, 33)
  assert.equal((await debug('eval', '__whaleMate.state().motions.ready')).value, true)
  console.log('PASS independent overlay loads the same bundled motion pack')
  overlay.send({ type: 'geometry', geometry })
  await until(async () => (await debug('eval', '__whaleMate.state().perch')).value === 'harness-window')
  console.log('PASS first geometry seats the character on the host window')
  assert.equal((await debug('eval', '__whaleMate.motions.get("sit").source.path')).value, 'Sitting_Idle_Loop')
  overlay.send({ type: 'cmd', method: 'action', args: ['q-sitting-talking-loop'] })
  await until(async () => (await debug('eval', '__whaleMate.gesture?.name')).value === 'q-sitting-talking-loop')
  assert.equal((await debug('eval', '__whaleMate.state().perch')).value, 'harness-window')
  console.log('PASS desktop commands play the new seated clip while retaining the host seat')
  overlay.send({ type: 'geometry', geometry: { ...geometry, hidden: true } })
  await until(async () => !(await debug('info')).visible)
  console.log('PASS hiding the host hides the overlay')
  overlay.send({ type: 'geometry', geometry })
  await until(async () => (await debug('info')).visible)
  console.log('PASS restoring the host restores the overlay')
  overlay.stop()
  assert.equal(overlay.running, false)
  console.log('PASS stop disposes the overlay child')
} finally {
  overlay.stop()
  await delay(1800)
  rmSync(root, { recursive: true, force: true })
}
