import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWin32Lister, desktopSurfaces, hostSpans, subtract, trackDesktopWindows } from '../desktop/windows.cjs'
import { virtualSurface } from '../src/pet/pet.js'

const app = (id, x, y, width, height, extra = {}) => ({ id, pid: 7, className: 'Chrome_WidgetWin_1', rect: { x, y, width, height }, minimized: false, owned: false, exStyle: 0, titled: true, ...extra })
const view = { viewport: { width: 1600, height: 900 }, selfPid: 1, headroom: 40, minTop: 180 }

test('interval subtraction', () => {
  assert.deepEqual(subtract([[0, 100]], 20, 40), [[0, 20], [40, 100]])
  assert.deepEqual(subtract([[0, 100]], -5, 200), [])
  assert.deepEqual(subtract([[0, 100], [150, 200]], 90, 160), [[0, 90], [160, 200]])
})

test('any app window is a perch; the parts of its edge behind front windows are not', () => {
  const front = app('front', 100, 200, 500, 400)
  const back = app('back', 300, 300, 900, 400) // edge y=300 runs behind `front` for x 300..600
  const list = desktopSurfaces([front, back], view)
  assert.deepEqual(list.map(s => s.id), ['front', 'back'])
  assert.deepEqual(list[0].spans, [[100, 600]])
  assert.deepEqual(list[1].spans, [[600, 1200]])
  // A window entirely in front of the edge removes the perch.
  assert.deepEqual(desktopSurfaces([app('cover', 250, 250, 1000, 500), back], view).map(s => [s.id, s.spans.length]), [['cover', 1], ['back', 0]])
  // A window ending well above her head room does not (and itself is too high to sit on).
  assert.deepEqual(desktopSurfaces([app('above', 300, 50, 900, 150), back], view).map(s => [s.id, s.spans]), [['back', [[300, 1200]]]])
})

test('shell, tool, untitled, minimised, own, tiny and screen-top windows are skipped', () => {
  const skipped = [
    app('tray', 0, 860, 1600, 40, { className: 'Shell_TrayWnd' }),
    app('desk', 0, 0, 1600, 900, { className: 'Progman' }),
    app('tool', 200, 300, 500, 300, { exStyle: 0x80 }),
    app('untitled', 200, 300, 500, 300, { titled: false }),
    app('min', 200, 300, 500, 300, { minimized: true }),
    app('self', 200, 300, 500, 300, { pid: 1 }),
    app('tiny', 200, 300, 100, 60),
    app('max', 0, 0, 1600, 860),
  ]
  const ok = desktopSurfaces([...skipped, app('ok', 200, 400, 600, 300)], view).map(s => [s.id, s.spans.length])
  // The maximised window is too high to sit on but hides `ok`; the shell windows never cover.
  assert.deepEqual(ok, [['ok', 0]])
  assert.deepEqual(desktopSurfaces([...skipped.filter(w => w.id !== 'max' && w.id !== 'tool' && w.id !== 'untitled' && w.id !== 'tiny'), app('ok', 200, 400, 600, 300)], view).map(s => s.id), ['ok'])
  // Harness's own windows have their own perch but still cover windows behind them.
  const list = desktopSurfaces([app('harness', 0, 350, 800, 500, { pid: 42 }), app('ok', 200, 400, 1000, 300)], { ...view, harnessPid: 42 })
  assert.deepEqual(list.map(s => [s.id, s.spans]), [['ok', [[800, 1200]]]])
  // Popup menus over an edge do not knock her off.
  assert.equal(desktopSurfaces([app('menu', 300, 380, 200, 300, { className: '#32768', titled: false }), app('ok', 200, 400, 600, 300)], view)[0].spans.length, 1)
})

test('coordinates are relative to the overlay and clipped to it', () => {
  const [s] = desktopSurfaces([app('w', -300, 500, 800, 300)], { ...view, origin: { x: -100, y: 20 } })
  assert.deepEqual([s.left, s.top, s.spans], [-200, 480, [[0, 600]]])
})

test('tracker publishes changes only, follows the perched window quickly and drops closed ones', async () => {
  let windows = [app('a', 100, 300, 600, 300), app('b', 800, 400, 600, 300)]
  const rects = { a: { x: 100, y: 300, width: 600, height: 300 } }
  const lister = { list: () => windows, refresh: id => rects[id] ?? null }
  const seen = []
  const t = trackDesktopWindows({ lister, toDip: r => r, onChange: l => seen.push(l), onError: e => assert.fail(e), options: () => view, interval: 1000, fast: 5 })
  const wait = async p => { for (let i = 0; i < 100 && !p(); i++) await new Promise(r => setTimeout(r, 5)); assert.ok(p()) }
  try {
    assert.equal(seen.length, 1)
    t.setPerched('a')
    rects.a = { x: 150, y: 320, width: 600, height: 300 }
    await wait(() => seen.at(-1)[0].left === 150)
    assert.equal(seen.at(-1)[0].top, 320)
    assert.deepEqual(seen.at(-1)[0].spans, [[150, 750]])
    const count = seen.length
    await new Promise(r => setTimeout(r, 30))
    assert.equal(seen.length, count, 'no duplicate publishes')
    delete rects.a
    await wait(() => seen.at(-1).every(s => s.id !== 'a'))
    windows = [app('b', 800, 420, 600, 300)]
    t.refreshNow()
    assert.equal(seen.at(-1)[0].top, 420)
  } finally { t.stop() }
})

test('engine-side surface accepts only the visible spans', () => {
  const s = virtualSurface('window')
  s.set({ left: 100, top: 300, width: 900, height: 300 }, [[100, 300], [600, 1000]])
  assert.equal(s.accepts(200), true)
  assert.equal(s.accepts(400), false)
  assert.equal(s.accepts(290, 20), false)
  assert.deepEqual(s.spanAt(700), [600, 1000])
  s.set({ left: 100, top: 300, width: 900, height: 300 })
  assert.equal(s.accepts(400), true)
  s.set(null)
  assert.equal(s.accepts(400), false)
  assert.equal(s.isConnected, false)
})

test('real Koffi marshals the all-windows lister (EnumWindows, ex-style, title length, refresh)', { skip: process.platform !== 'linux' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'whale-ffi-'))
  try {
    const library = join(dir, 'fixture.so')
    execFileSync('cc', ['-shared', '-fPIC', '-o', library, fileURLToPath(new URL('win32-ffi-fixture.c', import.meta.url))])
    const lister = createWin32Lister({ user: library, dwm: library })
    const list = lister.list()
    assert.deepEqual(list.map(w => [w.id, w.pid, w.className, w.titled, w.exStyle]), [['257', 42, 'Chrome_WidgetWin_1', true, 0], ['258', 99, 'Chrome_WidgetWin_1', false, 0x80]])
    assert.deepEqual(list[0].rect, { x: -1200, y: 450, width: 1200, height: 900 })
    assert.deepEqual(lister.refresh('257'), { x: -1200, y: 450, width: 1200, height: 900 })
    assert.equal(lister.refresh('999'), null)
    assert.deepEqual(desktopSurfaces(list, { selfPid: 1, viewport: { width: 1600, height: 1600 }, origin: { x: -1600, y: 0 }, minTop: 180 }).map(s => s.id), ['257'])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('Harness perches (top edge, composer) report the parts hidden by windows in front of Harness', () => {
  const harness = app('h', 200, 200, 1000, 600, { pid: 42 })
  const rects = { window: { left: 200, top: 200, width: 1000, height: 600 }, composer: { left: 300, top: 700, width: 800, height: 80 } }
  const o = { ...view, harnessPid: 42, rects }
  // Nothing in front: both fully usable (null).
  assert.deepEqual(hostSpans([harness, app('behind', 0, 0, 1600, 900)], o), { window: null, composer: null })
  // A window in front covering the left part of the composer (and not the top edge).
  const front = app('front', 100, 500, 600, 400)
  assert.deepEqual(hostSpans([front, harness], o), { window: null, composer: [[400, 800]] })
  // Fully covered: an empty list (she drops off after a moment).
  assert.deepEqual(hostSpans([app('big', 0, 0, 1600, 900), harness], o), { window: [], composer: [] })
  // Popup menus never count.
  assert.deepEqual(hostSpans([app('menu', 0, 0, 1600, 900, { className: '#32768' }), harness], o), { window: null, composer: null })
  // No Harness pid (page tracking): no occlusion information.
  assert.deepEqual(hostSpans([front, harness], { ...o, harnessPid: null }), { window: null, composer: null })
})
