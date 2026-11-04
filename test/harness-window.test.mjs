import { test } from 'node:test'
import assert from 'node:assert/strict'
import { officialDesktopPid, sanitize } from '../lib/desktop.js'
import { selectWindow, trackHarnessWindow } from '../desktop/harness-window.cjs'
import { seatRect } from '../desktop/seat.cjs'

const candidate = (id, pid, rect = { x: 100, y: 300, width: 1000, height: 600 }) => ({ id, pid, rect, className: 'Chrome_WidgetWin_1', owned: false, visible: true, minimized: false })

test('official Host detection uses the actual entry and parent PID, never a page-supplied PID', () => {
  const env = { ELECTRON_RUN_AS_NODE: '1' }
  assert.equal(officialDesktopPid({ argv: ['electron', 'C:\\Harness\\runtime\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\index.js'], env, ppid: 42 }), 42)
  assert.equal(officialDesktopPid({ argv: ['node', '/x/node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js'], env, ppid: 42 }), 42)
  assert.equal(officialDesktopPid({ argv: ['node', '/x/dsh/lib/index.js'], env, ppid: 42 }), null)
  assert.equal(officialDesktopPid({ argv: ['node', '/x/node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js'], env: {}, ppid: 42 }), null)
  assert.equal(sanitize({ type: 'native-geometry', pid: 42 }), null)
  assert.equal(sanitize({ type: 'geometry', geometry: { pid: 42 } }).geometry.pid, undefined)
})

test('only the owning desktop process is eligible, retaining the same window when hidden', () => {
  const host = candidate('host', 42)
  const foreign = candidate('other-app', 88)
  const dialog = { ...candidate('dialog', 42), owned: true }
  assert.equal(selectWindow([foreign, dialog, host], 42, null, null), host)
  const hidden = { ...host, visible: false, minimized: true }
  assert.equal(selectWindow([candidate('second', 42), hidden], 42, 'host', null), hidden)
  assert.equal(selectWindow([foreign, dialog], 42, null, null), null)
})

test('native tracker follows movement, DPI conversion, minimisation and restoration without page reports', async () => {
  let list = [candidate('host', 42)]
  const events = []
  const errors = []
  const screen = { screenToDipRect: (_, r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v / 1.5])) }
  const stop = trackHarnessWindow({ pid: 42, screen, read: () => list, onChange: e => events.push(e), onError: e => errors.push(e), interval: 5 })
  const until = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 5)) } assert.fail('tracker timed out') }
  try {
    assert.equal(events[0].win.top, 200)
    list = [candidate('host', 42, { x: -1500, y: 450, width: 1200, height: 900 })]
    await until(() => events.at(-1).win?.left === -1000)
    assert.equal(events.at(-1).win.top, 300)
    list[0] = { ...list[0], minimized: true }
    await until(() => events.at(-1).hidden)
    list[0] = { ...list[0], minimized: false }
    await until(() => events.at(-1).win?.top === 300)
    list = []
    await until(() => events.at(-1).hidden)
    assert.deepEqual(errors, [])
  } finally { stop() }
  const count = events.length
  list = [candidate('host', 42)]
  await new Promise(r => setTimeout(r, 20))
  assert.equal(events.length, count)
})

test('window seat uses the true edge, explicitly insets at screen top and clips offscreen width', () => {
  const view = { width: 1600, height: 900 }
  assert.deepEqual(seatRect({ left: 100, top: 300, width: 1000, height: 600 }, 220, view), { left: 100, top: 300, width: 1000, height: 600, inset: false })
  const maximised = seatRect({ left: 0, top: 0, width: 1600, height: 900 }, 220, view)
  assert.equal(maximised.inset, true)
  assert.ok(maximised.top > 180)
  const clipped = seatRect({ left: -400, top: 300, width: 1000, height: 600 }, 220, view)
  assert.equal(clipped.left, 0)
  assert.equal(clipped.width, 600)
  assert.equal(seatRect({ left: -1500, top: 300, width: 1000, height: 600 }, 220, view), null)
})
