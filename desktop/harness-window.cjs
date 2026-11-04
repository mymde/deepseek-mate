'use strict'

// Only the official Desktop shell's PID, supplied by its Host child, is eligible.
// No window titles, arbitrary application selection, or renderer-supplied PIDs.
function selectWindow(windows, pid, previous, hint) {
  const eligible = windows.filter((w) => w.pid === pid && !w.owned && w.className === 'Chrome_WidgetWin_1')
  const existing = eligible.find((w) => w.id === previous)
  if (existing) return existing
  const candidates = eligible.filter((w) => w.visible && !w.minimized && w.rect.width >= 500 && w.rect.height >= 400)
  const score = (w) =>
    hint
      ? Math.abs(w.rect.x - hint.x) +
        Math.abs(w.rect.y - hint.y) +
        Math.abs(w.rect.width - hint.width) +
        Math.abs(w.rect.height - hint.height)
      : -w.rect.width * w.rect.height
  return candidates.sort((a, b) => score(a) - score(b))[0] ?? null
}

function createWin32Reader(libraries = {}) {
  const koffi = require('./koffi.cjs').loadKoffi()
  const user = koffi.load(libraries.user ?? 'user32.dll')
  const dwm = koffi.load(libraries.dwm ?? 'dwmapi.dll')
  koffi.proto('int __stdcall WhaleEnumWindow(void *hwnd, intptr_t param)')
  const enumerate = user.func('int __stdcall EnumWindows(WhaleEnumWindow *callback, intptr_t param)')
  const getPid = user.func('uint32_t __stdcall GetWindowThreadProcessId(void *hwnd, _Out_ uint32_t *pid)')
  const getClass = user.func('int __stdcall GetClassNameW(void *hwnd, void *text, int count)')
  const visible = user.func('int __stdcall IsWindowVisible(void *hwnd)')
  const minimized = user.func('int __stdcall IsIconic(void *hwnd)')
  const owner = user.func('void * __stdcall GetWindow(void *hwnd, uint32_t command)')
  const rect = user.func('int __stdcall GetWindowRect(void *hwnd, void *rect)')
  const attribute = dwm.func(
    'int32_t __stdcall DwmGetWindowAttribute(void *hwnd, uint32_t attribute, void *value, uint32_t size)'
  )
  // GetWindowRect's fallback must also use physical pixels. Restore the thread context afterwards.
  const dpi = user.func('intptr_t __stdcall SetThreadDpiAwarenessContext(intptr_t context)')
  return (pid) => {
    const windows = []
    const previousDpi = dpi(-4) // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
    try {
      enumerate((hwnd) => {
        const processId = [0]
        getPid(hwnd, processId)
        if (processId[0] !== pid) return 1
        const name = Buffer.alloc(512)
        const length = getClass(hwnd, name, 256)
        if (name.toString('utf16le', 0, length * 2) !== 'Chrome_WidgetWin_1') return 1
        const r = Buffer.alloc(16)
        if (attribute(hwnd, 9, r, 16) !== 0 && !rect(hwnd, r)) return 1 // DWMWA_EXTENDED_FRAME_BOUNDS
        const cloaked = Buffer.alloc(4)
        attribute(hwnd, 14, cloaked, 4) // DWMWA_CLOAKED
        windows.push({
          id: String(koffi.address(hwnd)),
          pid,
          className: 'Chrome_WidgetWin_1',
          owned: !!owner(hwnd, 4),
          visible: !!visible(hwnd) && cloaked.readUInt32LE() === 0,
          minimized: !!minimized(hwnd),
          rect: {
            x: r.readInt32LE(0),
            y: r.readInt32LE(4),
            width: r.readInt32LE(8) - r.readInt32LE(0),
            height: r.readInt32LE(12) - r.readInt32LE(4)
          }
        })
        return 1
      }, 0)
    } finally {
      if (previousDpi) dpi(previousDpi)
    }
    return windows
  }
}

// Runs outside the Harness renderer: dragging/minimising the host cannot throttle this tracker.
function trackHarnessWindow({ pid, screen, onChange, onError, hint = () => null, read = null, interval = 50 }) {
  if (!read) {
    try {
      read = createWin32Reader()
    } catch (error) {
      // No native reader (koffi missing or blocked): report it and let the caller fall back.
      onError(error)
      return () => {}
    }
  }
  let selected = null
  let last = ''
  let timer
  const tick = () => {
    try {
      const windows = read(pid).map((w) => ({ ...w, rect: screen.screenToDipRect(null, w.rect) }))
      const w = selectWindow(windows, pid, selected, hint())
      selected = w?.id ?? null
      const value =
        w && w.visible && !w.minimized
          ? { hidden: false, win: { left: w.rect.x, top: w.rect.y, width: w.rect.width, height: w.rect.height } }
          : { hidden: true, win: null }
      const key = JSON.stringify(value)
      if (key !== last) {
        last = key
        onChange(value)
      }
    } catch (error) {
      clearInterval(timer)
      onChange({ hidden: true, win: null })
      onError(error)
    }
  }
  timer = setInterval(tick, interval)
  tick()
  return () => clearInterval(timer)
}

module.exports = { selectWindow, createWin32Reader, trackHarnessWindow }
