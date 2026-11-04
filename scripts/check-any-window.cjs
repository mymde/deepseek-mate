// "Sit on any window" regression: real Electron overlay + real BrowserWindows standing in for other
// applications. On Linux only the OS window list is substituted (front-to-back order kept by this
// script, rectangles from the real windows); on Windows the real Win32 lister is used for the
// windows, but the fake app windows below then belong to this process and are skipped, so run
// this on Linux. Usage: xvfb-run -s "-screen 0 1600x900x24" sh scripts/check-any-window-linux.sh <electron>
'use strict'
const { app, BrowserWindow, screen, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { startOverlay } = require('../desktop/main.cjs')
const { trackHarnessWindow } = require('../desktop/harness-window.cjs')

app.commandLine.appendSwitch('enable-unsafe-swiftshader')
app.commandLine.appendSwitch('use-angle', 'swiftshader')
app.commandLine.appendSwitch('enable-transparent-visuals')
const delay = ms => new Promise(r => setTimeout(r, ms))
const until = async (predicate, label = 'condition') => { for (let i = 0; i < 300; i++) { if (await predicate()) return; await delay(100) } throw new Error('Timed out: ' + label) }
const out = process.env.WHALE_TEST_OUT || join(__dirname, '../test/shots/any-window')
let count = 0
const check = (label, ok, info) => { if (!ok) console.log('FAIL', label, info !== undefined ? JSON.stringify(info) : ''); assert.ok(ok, label); console.log('PASS', label); count++ }
const HARNESS_PID = 42
const APP_PID = 77
let overlay
const windows = {} // name → BrowserWindow
let zorder = [] // front-to-back names

async function makeWindow(name, bounds, color) {
  const w = new BrowserWindow({ ...bounds, show: true, ...(process.platform === 'linux' ? { transparent: true, backgroundColor: color } : {}), webPreferences: { sandbox: true } })
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<body style="margin:0;background:${color};color:white;font:22px sans-serif"><div style="padding:30px">${name}</div></body>`))
  windows[name] = w
  zorder.unshift(name)
  return w
}
const raise = name => { zorder = [name, ...zorder.filter(n => n !== name)]; windows[name].moveTop() }
const info = name => { const w = windows[name]; return { id: name, pid: name === 'harness' ? HARNESS_PID : APP_PID, className: 'Chrome_WidgetWin_1', rect: w.getBounds(), minimized: w.isMinimized(), owned: false, exStyle: 0, titled: true } }
const lister = {
  list: () => zorder.filter(n => !windows[n].isDestroyed() && windows[n].isVisible()).map(info),
  refresh: id => { const w = windows[id]; return w && !w.isDestroyed() && w.isVisible() && !w.isMinimized() ? w.getBounds() : null },
}

app.whenReady().then(async () => {
  mkdirSync(out, { recursive: true })
  await makeWindow('editor', { x: 900, y: 360, width: 620, height: 420 }, '#2d4a3e')
  await makeWindow('browser', { x: 120, y: 520, width: 640, height: 300 }, '#4a2d3e')
  await makeWindow('harness', { x: 300, y: 330, width: 560, height: 420 }, '#172338')
  await delay(400)
  const responses = new Map()
  let id = 0
  let ready = false
  const errors = []
  const events = []
  const debug = (op, extra = {}) => new Promise((resolve, reject) => {
    const key = ++id
    const timer = setTimeout(() => { responses.delete(key); reject(new Error('debug timeout')) }, 20000)
    responses.set(key, m => { clearTimeout(timer); m.error ? reject(new Error(m.error)) : resolve(m) })
    overlay.receive({ type: 'debug', id: key, op, ...extra })
  })
  const evaluate = async code => (await debug('eval', { code })).value
  const state = () => evaluate('({...__whaleMate.state(), anchor: {...__whaleMate.anchor}, suspended: __whaleMate.suspended, gesture: __whaleMate.gesture?.name ?? null})')
  const shot = async name => writeFileSync(join(out, name + '.png'), Buffer.from((await debug('capture')).png, 'base64'))
  // Waits measured in pet time (software GL can be slow).
  const waitSim = async sec => { const t0 = Number(await evaluate('__whaleMate.t')); await until(async () => Number(await evaluate('__whaleMate.t')) - t0 >= sec, 'sim time') }
  const drop = async (x, y) => evaluate(`(() => { const p = __whaleMate; p.perch = null; p.atHome = false; p.anchor = { x: ${x}, y: ${y} }; p.vel = { x: 0, y: 0 }; p.setLoc('fall', true); return true })()`)

  overlay = startOverlay({ BrowserWindow, screen, ipcMain }, {
    harnessPid: HARNESS_PID, debug: true,
    send: m => { if (m.type === 'ready') ready = true; if (m.type === 'error') errors.push(m.message); if (m.type === 'event') events.push(m); if (m.type === 'debug') { responses.get(m.id)?.(m); responses.delete(m.id) } },
    trackWindow: options => trackHarnessWindow({ ...options, screen: { screenToDipRect: (_, r) => r },
      read: () => windows.harness.isDestroyed() ? [] : [{ ...info('harness'), visible: windows.harness.isVisible(), owned: false }] }),
    listWindows: lister,
  })
  await overlay.opened
  await until(() => ready, 'overlay ready')
  await evaluate('__whaleMate.nextIdle = 1e9')
  const b = (await debug('info')).bounds
  const rel = name => { const r = windows[name].getBounds(); return { left: r.x - b.x, top: r.y - b.y, width: r.width, height: r.height } }

  try { await until(async () => (await state()).perch === 'harness-window', 'harness seat') } catch (e) { console.log(JSON.stringify(await state()), JSON.stringify(await evaluate('JSON.stringify({h: __whaleMate.o.surfaces().map(s => [s.name, s.windowId, s.getBoundingClientRect(), s.spans?.()]) })')), JSON.stringify(rel('harness'))); throw e }
  let s = await state()
  check('default size is larger (360 px)', s.size === 360, s.size)
  check('reports other windows as perches', events.some(e => e.name === 'any-window' && e.data.state === 'following' && e.data.perches >= 2), events.filter(e => e.name === 'any-window'))
  await shot('1-harness')

  // Released above another application's window: she lands on its top edge.
  const editor = rel('editor')
  await drop(editor.left + 300, editor.top - 160)
  await until(async () => (await state()).loc === 'stand' || (await state()).loc === 'sit', 'landing')
  s = await state()
  check('dropped above another app window, she sits on its top edge', s.perchWindow === 'editor' && Math.abs(s.anchor.y - editor.top) < 2, s)
  await shot('2-editor')

  // The app window moves: she rides along (fast single-window refresh).
  windows.editor.setBounds({ x: 960, y: 420, width: 620, height: 420 })
  await until(async () => Math.abs((await state()).anchor.y - rel('editor').top) < 2, 'follow move')
  s = await state()
  check('follows the other window when it is dragged', s.perchWindow === 'editor', s)

  // Harness minimised: she stays on the desktop, on her window.
  windows.harness.minimize()
  await until(async () => !windows.harness.isVisible() || windows.harness.isMinimized(), 'harness minimised')
  await waitSim(1)
  s = await state()
  const i1 = await debug('info')
  check('Harness minimised: she stays on the desktop', i1.visible && !s.suspended && s.perchWindow === 'editor', { visible: i1.visible, s })

  // A window brought in front of her seat: she drops off after a moment.
  windows.browser.setBounds({ x: 900, y: 300, width: 700, height: 500 })
  raise('browser')
  await until(async () => (await state()).perchWindow !== 'editor', 'covered → drop')
  await until(async () => ['stand', 'sit'].includes((await state()).loc), 'landed after drop')
  s = await state()
  check('covered by a window in front, she leaves the hidden seat', s.perchWindow !== 'editor', s)
  await shot('3-covered')

  // Hop menu: onto the nearest other window.
  await evaluate('__whaleHop()')
  await until(async () => (await state()).perchWindow && ['stand', 'sit'].includes((await state()).loc), 'hop')
  s = await state()
  check('"跳到别的窗口上" lands on a window edge', !!s.perchWindow, s)
  const target = s.perchWindow

  // That window minimised: she falls to the taskbar/floor.
  windows[target].minimize()
  await until(async () => { const x = await state(); return x.perchWindow !== target && ['stand', 'sit'].includes(x.loc) }, 'fall off minimised window')
  s = await state()
  check('her window minimised: she drops to what is below (another window or the taskbar)', s.perch === 'floor' || (s.perchWindow && s.perchWindow !== target), s)
  windows[target].restore()

  // Harness restored: "坐到 Harness 窗口上" still works.
  windows.harness.restore()
  await until(async () => windows.harness.isVisible() && !windows.harness.isMinimized(), 'harness restore')
  await waitSim(0.5)
  overlay.receive({ type: 'cmd', method: 'recall', args: [] })
  await until(async () => (await state()).perch === 'harness-window', 'back on harness')
  check('recall returns her to the Harness window', true)

  // The page reports the composer: on the desktop it is her home, placed from the native window
  // rectangle plus the composer's offset inside the page.
  overlay.receive({ type: 'geometry', geometry: { screenX: 300, screenY: 330, outerWidth: 560, outerHeight: 420, innerWidth: 560, innerHeight: 390, dpr: 1, home: { left: 60, top: 300, width: 440, height: 70 }, hidden: false } })
  await waitSim(0.3)
  overlay.receive({ type: 'cmd', method: 'recall', args: [] })
  await until(async () => (await state()).perch === 'composer', 'composer seat')
  s = await state()
  check('desktop mode: she sits on the Harness composer', Math.abs(s.anchor.y - (660 - b.y)) < 2 && Math.abs(s.anchor.x - (360 - b.x)) <= 440, { s, want: 660 - b.y })
  await shot('5-composer')
  windows.harness.setBounds({ x: 340, y: 300, width: 560, height: 420 })
  await until(async () => Math.abs((await state()).anchor.y - (630 - b.y)) < 2, 'composer follows the window')
  check('the composer seat follows the Harness window', (await state()).perch === 'composer')
  windows.browser.setBounds({ x: 300, y: 560, width: 700, height: 300 })
  raise('browser')
  await until(async () => (await state()).perch !== 'composer', 'covered composer → drop')
  check('a window in front of the composer: she leaves the hidden seat', true)
  windows.browser.setBounds({ x: 120, y: 520, width: 640, height: 300 })

  // Right-click menu: mode switch and hide, plus the shortcuts picked in Settings.
  const menu = async () => JSON.parse(await evaluate(`JSON.stringify((() => { __whaleMate.openMenu(400, 400); const m = document.querySelector('.whale-mate__menu'); const r = m.getBoundingClientRect(); return { wheel: m.classList.contains('whale-mate__wheel'), items: [...m.querySelectorAll('[data-item]')].map(b => b.textContent), favs: [...m.querySelectorAll('[data-choice]')].map(b => b.dataset.choice), segs: m.querySelectorAll('.whale-mate__seg').length, rect: [r.left, r.top, r.width, r.height] } })())`))
  let m = await menu()
  check('right-click wheel shows only 窗口模式 and 隐藏 by default', m.wheel && JSON.stringify(m.items) === JSON.stringify(['窗口模式', '隐藏']) && m.favs.length === 0 && m.segs === 2, m)
  await evaluate('__whaleMate.closeMenu()')
  overlay.receive({ type: 'cmd', method: 'setFavorites', args: [['wave', 'face:happy', 'no-such-motion']] })
  await waitSim(0.2)
  m = await menu()
  check('shortcuts picked in Settings become wheel segments before them', JSON.stringify(m.favs) === JSON.stringify(['wave', 'face:happy']) && m.segs === 4, m)
  await evaluate(`document.querySelector('.whale-mate__seg[data-choice="face:happy"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
  await waitSim(0.2)
  check('a shortcut plays its expression', await evaluate(`__whaleMate.faceShown?.id === 'face:happy' && document.querySelector('.whale-mate__menu').hidden`))

  // Motion & expression picker.
  overlay.receive({ type: 'cmd', method: 'openMotionMenu', args: [] })
  await waitSim(0.3)
  const lib = JSON.parse(await evaluate(`JSON.stringify((() => { const m = document.querySelector('.whale-mate__library'); const r = m.getBoundingClientRect(); const p = __whaleMate; return { open: !m.hidden, tabs: [...m.querySelectorAll('.whale-mate__tab')].map(t => t.textContent), tiles: m.querySelectorAll('.whale-mate__tile').length, disabled: m.querySelectorAll('.whale-mate__tile:disabled').length, rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom }, body: { left: p.boxRect.left + p.box.w * 0.3, right: p.boxRect.left + p.box.w * 0.7 }, w: innerWidth, h: innerHeight } })())`))
  check('picker opens with category tabs and only playable tiles', lib.open && lib.tabs.length >= 5 && lib.tiles >= 20 && lib.disabled === 0, lib)
  check('picker sits beside her, not over her body', lib.rect.left >= lib.body.right - 2 || lib.rect.right <= lib.body.left + 2, lib)
  check('picker stays within the screen', lib.rect.left >= 0 && lib.rect.top >= 0 && lib.rect.right <= lib.w && lib.rect.bottom <= lib.h, lib)
  await evaluate(`document.querySelector('.whale-mate__tile[data-motion="wave"]').click()`)
  await waitSim(0.2)
  s = await state()
  const still = await evaluate(`!document.querySelector('.whale-mate__library').hidden && !!document.querySelector('.whale-mate__tile.is-on')`)
  check('clicking a tile plays it, highlights it and keeps the picker open', s.gesture === 'wave' && still, { gesture: s.gesture, still })
  await evaluate(`[...document.querySelectorAll('.whale-mate__tab')].find(t => t.textContent.startsWith('表情')).click()`)
  await evaluate(`document.querySelector('.whale-mate__tile[data-motion="face:happy"]').click()`)
  await waitSim(0.4)
  await shot('4-picker')
  check('expression tab shows faces and applies one', await evaluate(`document.querySelectorAll('.whale-mate__tile').length >= 10 && document.querySelector('.whale-mate__tile.is-on')?.dataset.motion === 'face:happy'`))
  check('no overlay errors', errors.length === 0, errors)
  console.log(`${count}/${count} passed (${process.platform}; OS window list ${process.platform === 'win32' ? 'real' : 'substituted by real BrowserWindow rectangles'})`)
}).then(() => { overlay?.close(); app.exit(0) }, e => { console.error(e); overlay?.close(); app.exit(1) })
