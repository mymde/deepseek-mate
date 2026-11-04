// Headless check of desktop mode: starts the real overlay through DesktopOverlay with an Electron
// runtime, feeds it a fake Harness window, and drives the mouse with xdotool.
// Usage (Linux): xvfb-run -s "-screen 0 1600x900x24" node scripts/check-desktop.mjs <electron> [outDir]
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { DesktopOverlay } from '../lib/desktop.js'
import { resolveModel } from '../lib/index.js'

const [electron, out = 'test/shots/desktop'] = process.argv.slice(2)
if (!electron) { console.error('usage: check-desktop.mjs <electron> [outDir]'); process.exit(2) }
mkdirSync(out, { recursive: true })
process.env.WHALE_MATE_DEBUG = '1'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const overlay = new DesktopOverlay({ config: { electron }, modelPath: resolveModel().path, log: (l, m) => console.log(`[${l}] ${m}`) })
let id = 0
const waiting = new Map()
overlay.onDebug = (m) => { waiting.get(m.id)?.(m); waiting.delete(m.id) }
const debug = (op, extra = {}) => new Promise((resolve) => { const i = ++id; waiting.set(i, resolve); overlay.send({ type: 'debug', id: i, op, ...extra }) })
const state = async () => JSON.parse((await debug('eval', { code: 'JSON.stringify({ ...__whaleMate.state(), anchor: __whaleMate.anchor, head: __whaleMate.headScreen, capture: __whaleMate.capture, suspended: __whaleMate.suspended, w: innerWidth, h: innerHeight })' })).value)
const simT = async () => Number((await debug('eval', { code: '__whaleMate.t' })).value)
// Software GL under Xvfb can be slow: wait in pet time, not wall time.
const waitSim = async (sec, maxMs = 90000) => { const t0 = await simT(); const end = Date.now() + maxMs; while ((await simT()) - t0 < sec && Date.now() < end) await sleep(150) }
const shot = async (name) => { const r = await debug('capture'); writeFileSync(`${out}/${name}.png`, Buffer.from(r.png, 'base64')); return r.bounds }
const xdo = (...args) => execFileSync('xdotool', args.map(String))
const results = []
const check = (name, ok, info) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, info !== undefined ? JSON.stringify(info) : '') }

const win = { screenX: 300, screenY: 330, outerWidth: 1000, outerHeight: 520, innerWidth: 1000, innerHeight: 520, dpr: 1, home: { left: 250, top: 380, width: 500, height: 110 }, hidden: false }
const geometry = (g) => overlay.send({ type: 'geometry', geometry: g })

xdo('mousemove', 50, 50)
await overlay.start({ size: 220 })
for (let i = 0; i < 100 && !overlay.ready; i++) await sleep(200)
check('overlay ready', overlay.ready, overlay.status().lastExit)
if (!overlay.ready) { console.log(overlay.status()); process.exit(1) }
const info = await debug('info')
check('covers the work area', Math.abs(info.bounds.width - 1600) <= 1 && Math.abs(info.bounds.height - 900) <= 1, info.bounds)
check(info.shape ? 'input shape mode (Linux)' : 'click-through by default', info.shape ? info.ignoring === false : info.ignoring === true)

geometry(win)
overlay.send({ type: 'cmd', method: 'recall', args: [] })
await waitSim(2.5)
let s = await state()
// The page reports the composer at (250, 380) inside the window: that is her home on the desktop too.
check('starts on the Harness composer', s.perch === 'composer' && Math.abs(s.anchor.y - (330 + 380)) < 2 && s.anchor.x >= 300 + 250 && s.anchor.x <= 300 + 750, { perch: s.perch, anchor: s.anchor })
await shot('1-composer')

// Hover: the cursor on her body makes the window take the mouse; elsewhere it stays click-through.
xdo('mousemove', Math.round(s.anchor.x), Math.round(s.anchor.y - 90))
await waitSim(0.3)
s = await state()
let i2 = await debug('info')
check('notices the cursor over her', s.capture === true && (info.shape || i2.ignoring === false), { capture: s.capture, ignoring: i2.ignoring })
xdo('mousemove', 1500, 120)
await waitSim(0.3)
s = await state()
i2 = await debug('info')
if (!info.shape) check('releases the mouse elsewhere', s.capture === false && i2.ignoring === true)

// Drag her onto the top edge of the Harness window.
s = await state()
xdo('mousemove', Math.round(s.anchor.x), Math.round(s.anchor.y - 90))
await waitSim(0.3)
xdo('mousedown', 1)
for (let k = 1; k <= 12; k++) { xdo('mousemove', Math.round(s.anchor.x + (950 - s.anchor.x) * k / 12), Math.round(s.anchor.y - 90 + (330 - 40 - (s.anchor.y - 90)) * k / 12)); await waitSim(0.06) }
await waitSim(0.6)
xdo('mouseup', 1)
xdo('mousemove', 1500, 120)
await waitSim(2)
s = await state()
check('dropped onto the window top edge', s.perch === 'harness-window' && Math.abs(s.anchor.y - 330) < 2, { perch: s.perch, anchor: s.anchor, loc: s.loc })
await shot('2-window-top')

// The window moves: she rides along.
geometry({ ...win, screenX: 360, screenY: 380 })
await waitSim(0.3)
s = await state()
check('follows the window when it moves', Math.abs(s.anchor.y - 380) < 2, s.anchor)

// Harness minimised: overlay hides and retains its perch.
geometry({ ...win, hidden: true })
await sleep(500)
s = await state()
check('hides with Harness and retains the seat', s.suspended && s.perch === 'harness-window' && !(await debug('info')).visible, { perch: s.perch, anchor: s.anchor })
await shot('3-floor')

// At the top of the screen the seat is inset to preserve headroom.
geometry({ ...win, screenY: 40, hidden: false, home: null })
await waitSim(0.2)
overlay.send({ type: 'cmd', method: 'recall', args: [] })
await waitSim(2.5)
s = await state()
check('insets a perch with no headroom', s.perch === 'harness-window' && s.anchor.y >= 220 * .82 && s.anchor.y < 250, { perch: s.perch, anchor: s.anchor, loc: s.loc })

// Chat relay.
geometry(win)
overlay.send({ type: 'cmd', method: 'say', args: ['你好，我在桌面上！', { expression: 'happy' }] })
await waitSim(0.4)
const bubble = (await debug('eval', { code: 'document.querySelector(".whale-mate__bubble").textContent' })).value
check('relays chat lines to the bubble', bubble === '你好，我在桌面上！', bubble)
await shot('4-say')

overlay.stop()
await sleep(500)
check('stops cleanly', !overlay.running)
const failed = results.filter((r) => !r.ok).length
console.log(`${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
