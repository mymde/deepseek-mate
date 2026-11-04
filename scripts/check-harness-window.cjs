// Electron integration regression. Uses a REAL local BrowserWindow fixture with the official
// shell's window options; it is NOT an end-to-end boot of the entire Harness distribution.
// On Windows the real Win32 reader is used. Linux substitutes only the OS reader with getBounds.
'use strict'
const { app, BrowserWindow, screen } = require('electron')
const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { startOverlay } = require('../desktop/main.cjs')
const { trackHarnessWindow } = require('../desktop/harness-window.cjs')

app.commandLine.appendSwitch('enable-unsafe-swiftshader')
app.commandLine.appendSwitch('use-angle', 'swiftshader')
app.commandLine.appendSwitch('enable-transparent-visuals')
const delay = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (predicate) => {
  for (let i = 0; i < 200; i++) {
    if (await predicate()) return
    await delay(100)
  }
  throw new Error('Timed out')
}
let overlay, host
const out = process.env.WHALE_TEST_OUT || join(__dirname, '../test/shots/harness-window')
let count = 0
const check = (label, ok) => {
  assert.ok(ok, label)
  console.log('PASS', label)
  count++
}
app
  .whenReady()
  .then(async () => {
    mkdirSync(out, { recursive: true })
    host = new BrowserWindow({
      x: 220,
      y: 300,
      width: 1000,
      height: 550,
      minWidth: 520,
      minHeight: 400,
      // Linux/X11 selects the process visual from its first window. Production runs the overlay
      // in a SEPARATE Electron process; this in-process fixture needs an ARGB first window too.
      ...(process.platform === 'linux' ? { transparent: true, backgroundColor: '#172338' } : {}),
      ...(process.platform === 'win32'
        ? { titleBarStyle: 'hidden', titleBarOverlay: { height: 36, color: '#172338', symbolColor: '#ffffff' } }
        : {}),
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    await host.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(
          '<body style="margin:0;background:#172338;color:white;font:20px sans-serif"><div style="padding:35px">Harness Desktop 窗口行为测试夹具<br><small>真实独立透明窗口 · 非完整 Harness 应用</small></div></body>'
        )
    )
    await delay(500)
    writeFileSync(join(out, 'host.png'), (await host.webContents.capturePage()).toPNG())
    let ready = false
    const responses = new Map()
    let id = 0
    const debug = (op, extra = {}) =>
      new Promise((resolve, reject) => {
        const key = ++id
        const timer = setTimeout(() => {
          responses.delete(key)
          reject(new Error('debug timeout'))
        }, 15000)
        responses.set(key, (m) => {
          clearTimeout(timer)
          m.error ? reject(new Error(m.error)) : resolve(m)
        })
        overlay.receive({ type: 'debug', id: key, op, ...extra })
      })
    const evaluate = async (code) => (await debug('eval', { code })).value
    const state = () =>
      evaluate(
        '({...__whaleMate.state(), anchor: {...__whaleMate.anchor}, suspended: __whaleMate.suspended, rect: {...__whaleMate.boxRect}})'
      )
    const errors = []
    overlay = startOverlay(
      { BrowserWindow, screen, ipcMain: require('electron').ipcMain },
      {
        harnessPid: process.pid,
        debug: true,
        size: 220,
        anyWindow: false,
        send: (m) => {
          if (m.type === 'ready') ready = true
          if (m.type === 'error') errors.push(m.message)
          if (m.type === 'debug') {
            responses.get(m.id)?.(m)
            responses.delete(m.id)
          }
        },
        ...(process.platform === 'win32'
          ? {}
          : {
              trackWindow: (options) =>
                trackHarnessWindow({
                  ...options,
                  screen: { screenToDipRect: (_, rect) => rect },
                  read: () =>
                    host.isDestroyed()
                      ? []
                      : [
                          {
                            id: 'host',
                            pid: process.pid,
                            className: 'Chrome_WidgetWin_1',
                            owned: false,
                            visible: host.isVisible(),
                            minimized: host.isMinimized(),
                            rect: host.getBounds()
                          }
                        ]
                })
            })
      }
    )
    await overlay.opened
    await until(() => ready)
    await evaluate('__whaleMate.nextIdle = 1e9')
    await until(async () => (await state()).perch === 'harness-window')
    await until(async () => (await evaluate('__whaleMate.t')) > 2)
    let s = await state()
    check(
      'starts seated on the host window, without any page geometry',
      s.loc === 'sit' && Math.abs(s.anchor.y - host.getBounds().y) < 2
    )
    check(
      'character extends above the host window in a separate transparent overlay',
      s.rect.top < host.getBounds().y - 50 && BrowserWindow.getAllWindows().length === 2
    )
    const shot = await debug('capture')
    writeFileSync(join(out, 'window-seat.png'), Buffer.from(shot.png, 'base64'))
    if (process.platform === 'linux')
      require('node:child_process').execFileSync('python3', [
        '-I',
        join(__dirname, 'xwd-png.py'),
        process.env.DISPLAY,
        join(out, 'desktop-seat.png')
      ])
    const oldX = s.anchor.x
    host.setBounds({ x: 330, y: 350, width: 1000, height: 500 })
    await until(async () => Math.abs((await state()).anchor.y - 350) < 2)
    s = await state()
    check('follows native movement without a renderer report', Math.abs(s.anchor.x - oldX - 110) < 2)
    // A background renderer reporting itself hidden must not override a visible native host.
    overlay.receive({
      type: 'geometry',
      geometry: { screenX: 0, screenY: 0, outerWidth: 10, outerHeight: 10, hidden: true }
    })
    await delay(200)
    check('ignores stale/hidden page geometry in native mode', (await debug('info')).visible)
    host.minimize()
    await until(async () => !(await debug('info')).visible)
    check('minimising hides the native overlay', (await state()).suspended)
    host.restore()
    await until(async () => (await debug('info')).visible)
    check('restoring returns to the same host perch', (await state()).perch === 'harness-window')
    host.hide()
    await until(async () => !(await debug('info')).visible)
    check('close-to-tray style hiding hides the overlay', (await state()).suspended)
    host.show()
    host.setBounds({ x: 0, y: 0, width: 1400, height: 850 })
    try {
      await until(async () => (await state()).anchor.y < 300 && (await debug('info')).visible)
    } catch (e) {
      console.log('DBG', JSON.stringify(await state()), JSON.stringify(await debug('info')))
      throw e
    }
    s = await state()
    check('screen-top window uses a reachable inset seat', s.perch === 'harness-window' && s.anchor.y >= 220 * 0.82)
    overlay.receive({ type: 'cmd', method: 'setSize', args: [340] })
    await until(async () => (await state()).anchor.y >= 340 * 0.82)
    check('resizing the pet adjusts the seat headroom', (await state()).perch === 'harness-window')
    host.destroy()
    await until(async () => !(await debug('info')).visible)
    check('destroyed host leaves no floating ghost', !(await debug('info')).visible)
    check('no overlay errors', errors.length === 0)
    console.log(
      `${count}/${count} passed; ${process.platform === 'win32' ? 'real Win32 reader' : 'Linux OS-reader fixture; Windows API execution still required'}`
    )
  })
  .then(
    () => {
      overlay?.close()
      host?.destroy()
      app.exit(0)
    },
    (e) => {
      console.error(e)
      overlay?.close()
      if (host && !host.isDestroyed()) host.destroy()
      app.exit(1)
    }
  )
