// Desktop overlay for dsh-plugin-whale-mate: one transparent, always-on-top, click-through
// window covering the work area of the display the Harness window is on. The pet engine runs
// inside it (overlay.html); the Harness page streams its window geometry and the chat-driven pet
// commands through the host plugin, which forwards them here.
//
// Two ways in:
//   - spawned:    <electron> app.cjs    (IPC channel to the host plugin via process.send)
//   - in-process: require('./main.cjs').startOverlay(electron, { send })  when the Harness host
//                 itself runs in an Electron main process.
'use strict'
const { createServer } = require('node:http')
const { statSync, createReadStream, mkdirSync } = require('node:fs')
const { join, extname } = require('node:path')
const { randomBytes } = require('node:crypto')
const os = require('node:os')
const { seatRect } = require('./seat.cjs')

const PUBLIC_DIR = join(__dirname, '..', 'public')
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.vrm': 'model/gltf-binary',
  '.json': 'application/json; charset=utf-8'
}

/** Serve overlay.html, pet.js and the avatar on a loopback port behind a random path prefix. */
function serveAssets(modelPath) {
  const token = randomBytes(12).toString('hex')
  const files = {
    'overlay.html': join(__dirname, 'overlay.html'),
    'pet.js': join(PUBLIC_DIR, 'pet.js'),
    'motions.json': join(PUBLIC_DIR, 'motions.json'),
    'model.vrm': modelPath
  }
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    const prefix = `/${token}/`
    const file = url.pathname.startsWith(prefix) ? files[url.pathname.slice(prefix.length)] : undefined
    if (!file || req.method !== 'GET') {
      res.writeHead(404)
      res.end()
      return
    }
    let size
    try {
      size = statSync(file).size
    } catch {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Content-Length': size,
      'Cache-Control': 'no-store'
    })
    createReadStream(file)
      .on('error', () => res.destroy())
      .pipe(res)
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, base: `http://127.0.0.1:${server.address().port}/${token}/` })
    )
  })
}

/**
 * Translate the Harness page's report (window.screenX/outerWidth/…, composer rect in CSS px)
 * into DIP rectangles on the screen.
 */
function screenRects(g, scaleFactor) {
  let zoom = g.dpr && scaleFactor ? g.dpr / scaleFactor : 1
  if (Math.abs(zoom - 1) < 0.03) zoom = 1
  const innerW = g.innerWidth * zoom
  const innerH = g.innerHeight * zoom
  const border = Math.max(0, Math.min(16, (g.outerWidth - innerW) / 2))
  const contentLeft = g.screenX + border
  const contentTop = g.screenY + Math.max(0, g.outerHeight - innerH - border)
  const win = {
    left: g.screenX + border,
    top: g.screenY,
    width: Math.max(0, g.outerWidth - border * 2),
    height: g.outerHeight
  }
  const home = g.home
    ? {
        left: contentLeft + g.home.left * zoom,
        top: contentTop + g.home.top * zoom,
        width: g.home.width * zoom,
        height: g.home.height * zoom
      }
    : null
  return { win, home }
}

function startOverlay(electron, opts = {}) {
  const { BrowserWindow, screen, ipcMain } = electron
  const send = opts.send ?? (() => {})
  const modelPath = opts.modelPath ?? process.env.WHALE_MATE_MODEL ?? join(PUBLIC_DIR, 'deepseek-reset.vrm')
  let win = null
  let assets = null
  let ready = false
  let closed = false
  let geometry = null
  let display = null
  let ignoring = null
  let lastCursor = null
  let nativeGeometry = null
  let nativeFailed = false // native Harness-window reader unavailable: follow the page's own report instead
  let stopTracking = null
  let trackingState = null
  const nativePid = Number(opts.harnessPid) || null
  const native = () => !!nativePid && !nativeFailed
  let petSize = opts.size ?? 360
  // Other applications' windows as perches (Windows: Win32 window list; tests inject a lister).
  let windowTracker = null
  let windowState = null
  let shownOnce = false
  // Harness's own perches in overlay coordinates (for occlusion by windows in front of Harness).
  let hostRects = { window: null, composer: null }
  // Linux cannot forward mouse moves through a click-through window (and Chromium only learns the
  // cursor position from its own windows' events there), so instead the window gets an input
  // shape covering just the pet, her bubble and menu.
  const useShape = process.platform === 'linux'
  const queue = []

  const toPage = (msg) => {
    if (ready && win && !win.isDestroyed()) win.webContents.send('whale-mate', msg)
    else queue.push(msg)
  }

  function placeOn(d) {
    if (!win || win.isDestroyed()) return
    display = d
    const a = d.workArea
    win.setBounds({ x: a.x, y: a.y, width: a.width, height: a.height })
  }

  // With other windows to sit on she lives on the desktop: Harness being minimised only removes
  // its own perch. Without them (macOS/Linux) she hides with Harness, as before.
  const freeRoam = () => windowState === 'following'
  function showOverlay(on) {
    if (on && ready && !win.isVisible()) {
      win.showInactive()
      shownOnce = true
    } else if (!on && win.isVisible()) win.hide()
  }

  function pushGeometry() {
    if (!win || win.isDestroyed()) return
    const hidden = native() ? !nativeGeometry || nativeGeometry.hidden : !geometry || geometry.hidden
    if (hidden) {
      hostRects = { window: null, composer: null }
      toPage({ type: 'geometry', hidden: true, win: null, home: null, free: freeRoam() })
      showOverlay(freeRoam() && shownOnce)
      return
    }
    const target = native()
      ? nativeGeometry.win
      : { left: geometry.screenX, top: geometry.screenY, width: geometry.outerWidth, height: geometry.outerHeight }
    const d0 = screen.getDisplayMatching({
      x: Math.round(target.left),
      y: Math.round(target.top),
      width: Math.max(1, Math.round(target.width)),
      height: Math.max(1, Math.round(target.height))
    })
    if (d0 && display && d0.id !== display.id) placeOn(d0)
    // Read bounds AFTER changing monitor: otherwise the first frame uses the old monitor origin.
    const b = win.getBounds()
    const page = geometry ? screenRects(geometry, (d0 ?? display)?.scaleFactor ?? 1) : null
    const w = native() ? nativeGeometry.win : page.win
    const rel = (r) => r && { left: r.left - b.x, top: r.top - b.y, width: r.width, height: r.height }
    const seat = seatRect(rel(w), petSize, b)
    // The composer, from the page's report. With the native window rectangle, only its offset
    // inside the window comes from the page (that does not change while the window moves).
    let home = null
    if (page?.home) {
      home = native()
        ? {
            left: w.left + (page.home.left - page.win.left),
            top: w.top + (page.home.top - page.win.top),
            width: page.home.width,
            height: page.home.height
          }
        : page.home
      home = rel(home)
      const inside =
        seat &&
        home.width >= 40 &&
        home.left + home.width > 0 &&
        home.left < b.width &&
        home.top > rel(w).top &&
        home.top < rel(w).top + rel(w).height
      if (!inside) home = null
    }
    hostRects = { window: seat, composer: home }
    toPage({ type: 'geometry', hidden: !seat, win: seat, home, actualWindow: rel(w), free: freeRoam() })
    showOverlay(!!seat || (freeRoam() && shownOnce))
  }

  function startWindowTracking() {
    if (opts.anyWindow === false) return
    let lister = opts.listWindows ?? null
    try {
      if (!lister && process.platform === 'win32') lister = require('./windows.cjs').createWin32Lister()
    } catch (error) {
      windowState = 'error'
      send({ type: 'event', name: 'any-window', data: { state: 'error', error: String(error.message) } })
      return
    }
    if (!lister) {
      windowState = 'unsupported'
      send({ type: 'event', name: 'any-window', data: { state: 'unsupported', platform: process.platform } })
      return
    }
    const { trackDesktopWindows } = require('./windows.cjs')
    const toDip =
      opts.windowsToDip ?? (process.platform === 'win32' ? (r) => screen.screenToDipRect(null, r) : (r) => r)
    let count = -1
    windowState = 'following'
    windowTracker = trackDesktopWindows({
      lister,
      toDip,
      options: () => {
        const b = win && !win.isDestroyed() ? win.getBounds() : { x: 0, y: 0, width: 0, height: 0 }
        return {
          selfPid: process.pid,
          harnessPid: nativePid,
          origin: { x: b.x, y: b.y },
          viewport: { width: b.width, height: b.height },
          headroom: Math.round(petSize * 0.2),
          minTop: Math.round(petSize * 0.82),
          hostRects
        }
      },
      onChange: (list, host) => {
        toPage({ type: 'windows', list, host })
        if (list.length !== count) {
          count = list.length
          send({ type: 'event', name: 'any-window', data: { state: windowState, perches: count } })
        }
      },
      onError: (error) => {
        windowState = 'error'
        send({ type: 'event', name: 'any-window', data: { state: 'error', error: String(error.message) } })
        pushGeometry()
      },
      interval: opts.windowInterval,
      fast: opts.windowFastInterval
    })
  }

  function setIgnore(ignore) {
    if (!win || win.isDestroyed() || ignore === ignoring) return
    ignoring = ignore
    if (ignore) win.setIgnoreMouseEvents(true, { forward: true })
    else win.setIgnoreMouseEvents(false)
  }

  const onPageMessage = (event, msg) => {
    if (!win || event.sender !== win.webContents || !msg || typeof msg !== 'object') return
    if (msg.type === 'ready') {
      ready = true
      for (const m of queue.splice(0)) win.webContents.send('whale-mate', m)
      pushGeometry()
      send({ type: 'ready' })
    } else if (msg.type === 'capture') {
      if (!useShape) setIgnore(!msg.on)
    } else if (msg.type === 'shape' && useShape && Array.isArray(msg.rects)) {
      const rects = msg.rects.slice(0, 8).map((r) => ({
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.max(1, Math.round(r.width)),
        height: Math.max(1, Math.round(r.height))
      }))
      try {
        win.setShape(rects)
      } catch {}
    } else if (msg.type === 'event' || msg.type === 'error') {
      send(msg)
    } else if (msg.type === 'perch') {
      windowTracker?.setPerched(typeof msg.id === 'string' ? msg.id : null)
    } else if (msg.type === 'size' && Number.isFinite(msg.size)) {
      petSize = Math.max(140, Math.min(480, msg.size))
      pushGeometry()
    }
  }

  // Cursor polling: with click-through on, the page only sees the mouse when it is over the pet
  // (and on Linux not even then), so feed the OS cursor for gaze, hover and pat detection.
  const cursorTimer = setInterval(() => {
    if (!ready || !win || win.isDestroyed() || !win.isVisible()) return
    const p = screen.getCursorScreenPoint()
    if (lastCursor && p.x === lastCursor.x && p.y === lastCursor.y) return
    lastCursor = p
    const b = win.getBounds()
    win.webContents.send('whale-mate', { type: 'cursor', x: p.x - b.x, y: p.y - b.y })
  }, 33)

  const onDisplays = () => {
    if (!win || win.isDestroyed()) return
    const ds = screen.getAllDisplays()
    placeOn(ds.find((d) => display && d.id === display.id) ?? screen.getPrimaryDisplay())
    pushGeometry()
  }

  async function open() {
    assets = await serveAssets(modelPath)
    if (closed) {
      assets.server.close()
      return
    }
    const primary = screen.getPrimaryDisplay()
    display = primary
    const a = primary.workArea
    win = new BrowserWindow({
      x: a.x,
      y: a.y,
      width: a.width,
      height: a.height,
      transparent: true,
      backgroundColor: '#00000000',
      frame: false,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      title: 'Whale Mate',
      webPreferences: {
        preload: join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        spellcheck: false
      }
    })
    win.setAlwaysOnTop(true, 'screen-saver')
    if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    if (useShape) {
      win.setShape([{ x: 0, y: 0, width: 1, height: 1 }])
      setIgnore(false)
    } else setIgnore(true)
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    win.webContents.on('render-process-gone', (_e, d) =>
      send({ type: 'error', message: 'overlay renderer exited: ' + d.reason })
    )
    win.webContents.on('console-message', (...args) => {
      const e = args[0]
      const level = e?.level ?? args[1]
      const message = e?.message ?? args[2]
      if (level === 'error' || level === 3) send({ type: 'log', level: 'error', message: String(message) })
    })
    // Wait for both the model and a real host window; never flash a pet on an unrelated screen.
    win.once('ready-to-show', pushGeometry)
    win.on('closed', () => {
      win = null
    })
    ipcMain.on('whale-mate', onPageMessage)
    screen.on('display-added', onDisplays)
    screen.on('display-removed', onDisplays)
    screen.on('display-metrics-changed', onDisplays)
    if (nativePid) {
      const tracker = opts.trackWindow ?? require('./harness-window.cjs').trackHarnessWindow
      stopTracking = tracker({
        pid: nativePid,
        screen,
        hint: () =>
          geometry && {
            x: geometry.screenX,
            y: geometry.screenY,
            width: geometry.outerWidth,
            height: geometry.outerHeight
          },
        onChange: (value) => {
          nativeGeometry = value
          const state = value.hidden ? 'hidden-or-unavailable' : 'following'
          if (state !== trackingState) {
            trackingState = state
            send({ type: 'event', name: 'tracking', data: { source: 'official-desktop-win32', pid: nativePid, state } })
          }
          pushGeometry()
        },
        onError: (error) => {
          nativeFailed = true
          send({
            type: 'event',
            name: 'tracking',
            data: { source: 'page', pid: nativePid, state: 'error', fallback: true, error: String(error.message) }
          })
          send({
            type: 'log',
            level: 'warn',
            message: 'Harness 窗口原生跟踪不可用，改用页面上报的位置：' + error.message
          })
          pushGeometry()
        }
      })
    }
    if (!nativePid) send({ type: 'event', name: 'tracking', data: { source: 'page', pid: null } })
    startWindowTracking()
    const q = new URLSearchParams({ size: String(petSize), shape: useShape ? '1' : '0' })
    await win.loadURL(assets.base + 'overlay.html?' + q)
  }

  function receive(msg) {
    if (!msg || typeof msg !== 'object') return
    if (msg.type === 'geometry') {
      geometry = msg.geometry ?? null
      pushGeometry()
      return
    }
    if (msg.type === 'cmd' || msg.type === 'visible') toPage(msg)
    // Test hooks (only from the parent process; the host never relays these from the page).
    if (msg.type === 'debug' && opts.debug && win && !win.isDestroyed()) {
      const reply = (data) => send({ type: 'debug', id: msg.id, ...data })
      if (msg.op === 'capture')
        win.webContents.capturePage().then(
          (img) => reply({ png: img.toPNG().toString('base64'), bounds: win.getBounds() }),
          (e) => reply({ error: String(e) })
        )
      else if (msg.op === 'eval')
        win.webContents.executeJavaScript(String(msg.code)).then(
          (value) => reply({ value }),
          (e) => reply({ error: String(e) })
        )
      else if (msg.op === 'info')
        reply({
          bounds: win.getBounds(),
          visible: win.isVisible(),
          ignoring,
          shape: useShape,
          display: display?.workArea,
          nativePid,
          windows: windowState
        })
    }
  }

  function close() {
    if (closed) return
    closed = true
    clearInterval(cursorTimer)
    stopTracking?.()
    windowTracker?.stop()
    ipcMain.removeListener('whale-mate', onPageMessage)
    screen.removeListener('display-added', onDisplays)
    screen.removeListener('display-removed', onDisplays)
    screen.removeListener('display-metrics-changed', onDisplays)
    if (win && !win.isDestroyed()) win.destroy()
    win = null
    assets?.server.close()
  }

  const opened = open().catch((e) => {
    send({ type: 'error', message: String(e?.stack ?? e) })
    throw e
  })
  return { receive, close, opened }
}

/** Entry for the spawned overlay process (desktop/app.cjs), talking to the host over Node IPC. */
function runSpawned() {
  const electron = require('electron')
  const { app } = electron
  if (!app) {
    console.error('whale-mate overlay: not running under Electron')
    process.exit(2)
  }
  const dataDir = process.env.WHALE_MATE_DATA ?? join(os.homedir(), '.dsh-whale-mate', 'overlay-data')
  try {
    mkdirSync(dataDir, { recursive: true })
    app.setPath('userData', dataDir)
  } catch {}
  app.setName('Whale Mate')
  if (process.platform === 'linux') app.commandLine.appendSwitch('enable-transparent-visuals')
  // Software WebGL when the GPU is blocklisted or absent (the overlay only renders local content).
  app.commandLine.appendSwitch('enable-unsafe-swiftshader')
  for (const flag of (process.env.WHALE_MATE_ELECTRON_FLAGS ?? '').split(/\s+/).filter(Boolean)) {
    const [k, v] = flag.replace(/^--/, '').split('=')
    app.commandLine.appendSwitch(k, v)
  }
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    process.exit(0)
  }
  app.dock?.hide?.()
  const send = (m) => {
    try {
      process.send?.(m)
    } catch {}
  }
  let overlay = null
  const pending = []
  process.on('message', (m) => {
    if (overlay) overlay.receive(m)
    else pending.push(m)
  })
  process.on('disconnect', () => {
    overlay?.close()
    app.quit()
  })
  app.on('window-all-closed', () => {})
  app.whenReady().then(() => {
    overlay = startOverlay(electron, {
      send,
      size: Number(process.env.WHALE_MATE_SIZE) || 360,
      harnessPid: process.platform === 'win32' ? Number(process.env.WHALE_MATE_HARNESS_PID) : null,
      debug: process.env.WHALE_MATE_DEBUG === '1'
    })
    for (const m of pending.splice(0)) overlay.receive(m)
    overlay.opened.catch(() => app.exit(1))
  })
  if (!process.send) {
    // Started by hand (debugging): no host. Pretend a centred Harness window so there is a perch.
    app.whenReady().then(() =>
      setTimeout(() => {
        const a = electron.screen.getPrimaryDisplay().workArea
        overlay?.receive({
          type: 'geometry',
          geometry: {
            screenX: a.x + a.width * 0.2,
            screenY: a.y + a.height * 0.35,
            outerWidth: a.width * 0.6,
            outerHeight: a.height * 0.6,
            innerWidth: a.width * 0.6,
            innerHeight: a.height * 0.6,
            dpr: 1,
            home: null,
            hidden: false
          }
        })
      }, 1500)
    )
  }
}

module.exports = { startOverlay, screenRects, runSpawned }
