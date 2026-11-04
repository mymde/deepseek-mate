'use strict'
// "Sit on any window": the top edges of other applications' windows become perches.
//
// The OS reader lists top-level windows front-to-back (EnumWindows order is the Z order).
// desktopSurfaces() turns that list into perches: for every ordinary app window, the parts of its
// top edge that are not covered by a window in front of it. Only rectangles leave this module;
// no titles, process names or window contents are read or sent anywhere.

const SHELL_CLASSES = new Set([
  'Progman',
  'WorkerW',
  'Shell_TrayWnd',
  'Shell_SecondaryTrayWnd',
  'NotifyIconOverflowWindow',
  'TopLevelWindowForOverflowXamlIsland',
  'XamlExplorerHostIslandWindow',
  'Windows.UI.Core.CoreWindow',
  'ForegroundStaging',
  'MultitaskingViewFrame',
  'TaskListThumbnailWnd',
  'tooltips_class32',
  'SysShadow'
])
const TRANSIENT_CLASSES = new Set(['#32768', 'DropDown', 'ComboLBox'])
const WS_EX_TOOLWINDOW = 0x80
const WS_EX_TRANSPARENT = 0x20
const WS_EX_NOACTIVATE = 0x08000000

/** Front-to-back list of visible top-level windows: { id, pid, className, rect, minimized, owned, exStyle, titled } (physical px). */
function createWin32Lister(libraries = {}) {
  const koffi = require('./koffi.cjs').loadKoffi()
  const user = koffi.load(libraries.user ?? 'user32.dll')
  const dwm = koffi.load(libraries.dwm ?? 'dwmapi.dll')
  koffi.proto('int __stdcall WhaleEnumAll(void *hwnd, intptr_t param)')
  const enumerate = user.func('int __stdcall EnumWindows(WhaleEnumAll *callback, intptr_t param)')
  const getPid = user.func('uint32_t __stdcall GetWindowThreadProcessId(void *hwnd, _Out_ uint32_t *pid)')
  const getClass = user.func('int __stdcall GetClassNameW(void *hwnd, void *text, int count)')
  const visible = user.func('int __stdcall IsWindowVisible(void *hwnd)')
  const minimized = user.func('int __stdcall IsIconic(void *hwnd)')
  const owner = user.func('void * __stdcall GetWindow(void *hwnd, uint32_t command)')
  const titleLength = user.func('int __stdcall GetWindowTextLengthW(void *hwnd)')
  const rect = user.func('int __stdcall GetWindowRect(void *hwnd, void *rect)')
  let longPtr
  try {
    longPtr = user.func('intptr_t __stdcall GetWindowLongPtrW(void *hwnd, int index)')
  } catch {
    longPtr = user.func('int32_t __stdcall GetWindowLongW(void *hwnd, int index)')
  }
  const attribute = dwm.func(
    'int32_t __stdcall DwmGetWindowAttribute(void *hwnd, uint32_t attribute, void *value, uint32_t size)'
  )
  const dpi = user.func('intptr_t __stdcall SetThreadDpiAwarenessContext(intptr_t context)')
  const isWindow = user.func('int __stdcall IsWindow(void *hwnd)')
  const handles = new Map() // id → hwnd, for the cheap single-window refresh

  const bounds = (hwnd, r) => attribute(hwnd, 9, r, 16) === 0 || rect(hwnd, r) // DWMWA_EXTENDED_FRAME_BOUNDS, then GetWindowRect
  const toRect = (r) => ({
    x: r.readInt32LE(0),
    y: r.readInt32LE(4),
    width: r.readInt32LE(8) - r.readInt32LE(0),
    height: r.readInt32LE(12) - r.readInt32LE(4)
  })
  const withDpi = (fn) => {
    const previous = dpi(-4)
    try {
      return fn()
    } finally {
      if (previous) dpi(previous)
    }
  }

  function list() {
    return withDpi(() => {
      const windows = []
      handles.clear()
      const name = Buffer.alloc(512)
      const r = Buffer.alloc(16)
      const cloaked = Buffer.alloc(4)
      enumerate((hwnd) => {
        if (!visible(hwnd)) return 1
        cloaked.writeUInt32LE(0)
        attribute(hwnd, 14, cloaked, 4) // DWMWA_CLOAKED: other virtual desktops, suspended UWP apps
        if (cloaked.readUInt32LE() !== 0) return 1
        if (!bounds(hwnd, r)) return 1
        const box = toRect(r)
        if (box.width <= 0 || box.height <= 0) return 1
        const length = getClass(hwnd, name, 256)
        const processId = [0]
        getPid(hwnd, processId)
        const id = String(koffi.address(hwnd))
        handles.set(id, hwnd)
        windows.push({
          id,
          pid: processId[0],
          className: name.toString('utf16le', 0, length * 2),
          rect: box,
          minimized: !!minimized(hwnd),
          owned: !!owner(hwnd, 4),
          exStyle: Number(longPtr(hwnd, -20)) >>> 0,
          titled: titleLength(hwnd) > 0
        })
        return 1
      }, 0)
      return windows
    })
  }

  /** Current rectangle of one window from the last list(), or null when it is gone/minimised. */
  function refresh(id) {
    const hwnd = handles.get(id)
    if (!hwnd) return null
    return withDpi(() => {
      if (!isWindow(hwnd) || !visible(hwnd) || minimized(hwnd)) return null
      const r = Buffer.alloc(16)
      return bounds(hwnd, r) ? toRect(r) : null
    })
  }
  return { list, refresh }
}

/** Ordinary application windows only: no shell, tool windows, tooltips, menus or our own windows. */
function isAppWindow(w, selfPid) {
  if (w.pid === selfPid || w.minimized || SHELL_CLASSES.has(w.className)) return false
  if (w.exStyle & (WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE)) return false
  if (!w.titled && !w.harness) return false
  return w.rect.width >= 240 && w.rect.height >= 120
}

/** Subtract [a, b] intervals from [left, right]; returns the remaining pieces. */
function subtract(spans, a, b) {
  const out = []
  for (const [l, r] of spans) {
    if (b <= l || a >= r) {
      out.push([l, r])
      continue
    }
    if (a > l) out.push([l, a])
    if (b < r) out.push([b, r])
  }
  return out
}

/**
 * Perches from a front-to-back window list, in overlay coordinates (DIP relative to `origin`).
 * Each perch: { id, left, top, width, height, spans: [[left, right], …] } with only the uncovered
 * parts of the top edge (plus `headroom` px above it) left in spans. Harness's own windows are
 * left out (the Harness window has its own perch) but still cover the windows behind them.
 */
function desktopSurfaces(
  windows,
  {
    selfPid,
    harnessPid = null,
    origin = { x: 0, y: 0 },
    viewport,
    headroom = 40,
    minTop = 0,
    minSpan = 90,
    max = 24
  } = {}
) {
  const covers = []
  const out = []
  for (const w of windows) {
    if (w.minimized || w.pid === selfPid) continue
    const r = { left: w.rect.x - origin.x, top: w.rect.y - origin.y, width: w.rect.width, height: w.rect.height }
    const harness = harnessPid !== null && w.pid === harnessPid
    if (!harness && isAppWindow(w, selfPid) && out.length < max && r.top >= minTop && r.top < viewport.height - 60) {
      // Whatever is in front of the edge itself or of the space where she sits above it.
      let spans = [[Math.max(0, r.left), Math.min(viewport.width, r.left + r.width)]]
      for (const c of covers)
        if (c.top < r.top + 2 && c.top + c.height > r.top - headroom) spans = subtract(spans, c.left, c.left + c.width)
      // Kept even when fully covered (spans = []): she gets a moment before dropping off, and
      // the window keeps its identity for when it comes back to the front.
      out.push({ id: w.id, ...r, spans: spans.filter(([a, b]) => b - a >= minSpan) })
    }
    // Every visible window (app, Harness, dialog, palette) hides what is behind it. Transient
    // popup menus and tooltips do not: she should not fall off because a menu opened over her.
    if (!SHELL_CLASSES.has(w.className) && !TRANSIENT_CLASSES.has(w.className) && !(w.exStyle & WS_EX_TRANSPARENT))
      covers.push(r)
  }
  return out
}

/**
 * Which parts of Harness's own perches (its top edge, the chat composer; overlay coordinates) are
 * hidden by windows in front of the Harness window. Returns { [key]: null | [[a, b], …] } with
 * spans relative to each rectangle's left edge; null = nothing in front, all of it is usable.
 */
function hostSpans(
  windows,
  { selfPid, harnessPid = null, origin = { x: 0, y: 0 }, rects = {}, headroom = 40, minSpan = 90 } = {}
) {
  const out = {}
  const keys = Object.keys(rects).filter((k) => rects[k])
  for (const k of Object.keys(rects)) out[k] = null
  if (harnessPid === null || !keys.length) return out
  const covers = []
  for (const w of windows) {
    if (w.minimized || w.pid === selfPid) continue
    if (w.pid === harnessPid) {
      // The frontmost Harness window: everything collected so far is in front of it.
      for (const k of keys) {
        const r = rects[k]
        const full = [[Math.max(0, r.left), r.left + r.width]]
        let spans = full
        for (const c of covers)
          if (c.top < r.top + 2 && c.top + c.height > r.top - headroom)
            spans = subtract(spans, c.left, c.left + c.width)
        if (spans.length === 1 && spans[0][0] === full[0][0] && spans[0][1] === full[0][1]) continue
        out[k] = spans.filter(([a, b]) => b - a >= minSpan).map(([a, b]) => [a - r.left, b - r.left])
      }
      return out
    }
    if (!SHELL_CLASSES.has(w.className) && !TRANSIENT_CLASSES.has(w.className) && !(w.exStyle & WS_EX_TRANSPARENT)) {
      covers.push({ left: w.rect.x - origin.x, top: w.rect.y - origin.y, width: w.rect.width, height: w.rect.height })
    }
  }
  return out
}

/**
 * Poll the window list (default 8 Hz) and the window she sits on (30 Hz, so dragging a window
 * carries her smoothly). Calls onChange(perches) only when something moved.
 */
function trackDesktopWindows({ lister, toDip, onChange, onError, options, interval = 120, fast = 33 }) {
  let last = ''
  let perched = null
  let surfaces = []
  let host = {}
  const publish = () => {
    const key = JSON.stringify([surfaces, host])
    if (key !== last) {
      last = key
      onChange(surfaces, host)
    }
  }
  const fail = (error) => {
    stop()
    onChange([], {})
    onError(error)
  }
  const full = () => {
    try {
      const windows = lister.list().map((w) => ({ ...w, rect: toDip(w.rect) }))
      const o = options()
      surfaces = desktopSurfaces(windows, o)
      host = hostSpans(windows, { ...o, rects: o.hostRects ?? {} })
      publish()
    } catch (error) {
      fail(error)
    }
  }
  const quick = () => {
    if (!perched || !lister.refresh) return
    try {
      const index = surfaces.findIndex((s) => s.id === perched)
      if (index < 0) return
      const raw = lister.refresh(perched)
      const s = surfaces[index]
      if (!raw) {
        surfaces = surfaces.filter((x) => x.id !== perched)
        publish()
        return
      }
      const o = options().origin ?? { x: 0, y: 0 }
      const r = toDip(raw)
      const dx = r.x - o.x - s.left
      const dy = r.y - o.y - s.top
      if (!dx && !dy && r.width === s.width) return
      // Moved: shift the visible spans with it until the next full pass recomputes coverage.
      surfaces = surfaces.slice()
      surfaces[index] = {
        ...s,
        left: s.left + dx,
        top: s.top + dy,
        width: r.width,
        height: r.height,
        spans: s.spans.map(([a, b]) => [a + dx, b + dx])
      }
      publish()
    } catch (error) {
      fail(error)
    }
  }
  const slow = setInterval(full, interval)
  const rapid = setInterval(quick, fast)
  const stop = () => {
    clearInterval(slow)
    clearInterval(rapid)
  }
  full()
  return {
    stop,
    setPerched: (id) => {
      perched = id ?? null
    },
    refreshNow: full
  }
}

module.exports = {
  createWin32Lister,
  desktopSurfaces,
  hostSpans,
  isAppWindow,
  subtract,
  trackDesktopWindows,
  SHELL_CLASSES
}
