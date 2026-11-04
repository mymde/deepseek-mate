// Desktop mode: show the pet in a transparent always-on-top window on the user's desktop instead
// of inside the Harness page, so she can sit on top of the Harness window, stand on the taskbar
// and be dragged anywhere on screen.
//
// The overlay is an Electron window (desktop/main.cjs). Runtime, in order of preference:
//   1. config.electron / DSH_WHALE_MATE_ELECTRON: an Electron executable the user points at;
//   2. the Harness host itself, when it runs in an Electron main process;
//   3. a copy downloaded on first use into ~/.dsh-whale-mate/runtime (verified against the
//      release's SHASUMS256.txt).
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { downloadArchive, downloadText, downloadError, sha256 } from './runtime-download.js'
import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  chmodSync,
  symlinkSync,
  openSync,
  readSync,
  closeSync,
  fstatSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'
import { readFileSync } from 'node:fs'

export const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
  } catch {
    return 'unknown'
  }
})()

export const ELECTRON_VERSION = '44.10.2'
export const MIRRORS = [
  'https://registry.npmmirror.com/-/binary/electron/',
  'https://github.com/electron/electron/releases/download/'
]
const MAIN = fileURLToPath(new URL('../desktop/main.cjs', import.meta.url))
const APP = fileURLToPath(new URL('../desktop/app.cjs', import.meta.url))

export function dataRoot(env = process.env) {
  return env.DSH_WHALE_MATE_HOME || join(homedir(), '.dsh-whale-mate')
}

/** Can a window opened by this host process appear in front of the person using the page? */
export function displayAvailable(platform = process.platform, env = process.env) {
  if (platform === 'win32' || platform === 'darwin') return true
  return !!(env.DISPLAY || env.WAYLAND_DISPLAY)
}

export function isLoopback(req) {
  const a = req?.socket?.remoteAddress ?? ''
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1'
}

// apps/desktop/src/host-process.ts spawns apps/desktop-host directly in Node mode.
// Derive the shell PID here, never from page requests or a title-based process search.
export function officialDesktopPid({ argv = process.argv, env = process.env, ppid = process.ppid } = {}) {
  return env.ELECTRON_RUN_AS_NODE === '1' &&
    /[\\/]@deepseek-ai[\\/]dsh-desktop-host[\\/]lib[\\/]index\.js$/.test(argv[1] ?? '') &&
    Number.isSafeInteger(ppid) &&
    ppid > 0
    ? ppid
    : null
}

export function assetName(version = ELECTRON_VERSION, platform = process.platform, arch = process.arch) {
  const p = { win32: 'win32', darwin: 'darwin', linux: 'linux' }[platform]
  const a = { x64: 'x64', arm64: 'arm64', ia32: 'ia32', arm: 'armv7l' }[arch]
  return p && a ? `electron-v${version}-${p}-${a}.zip` : null
}

export function electronExecutable(dir, platform = process.platform) {
  if (platform === 'win32') return join(dir, 'electron.exe')
  if (platform === 'darwin') return join(dir, 'Electron.app', 'Contents', 'MacOS', 'Electron')
  return join(dir, 'electron')
}

// ---------------------------------------------------------------------------- zip

function u16(b, o) {
  return b.readUInt16LE(o)
}
function u32(b, o) {
  return b.readUInt32LE(o)
}
function u64(b, o) {
  return Number(b.readBigUInt64LE(o))
}

/**
 * Run synchronous file work with Electron's asar support off. The official Harness Desktop runs
 * this host under Electron (ELECTRON_RUN_AS_NODE), whose fs treats every "*.asar" path as an
 * archive: writing or deleting the runtime's resources/default_app.asar then fails with
 * "Invalid package". Plain Node ignores the flag. Sync only, so no other code sees it switched.
 */
export function withoutAsar(fn) {
  const previous = process.noAsar
  process.noAsar = true
  try {
    return fn()
  } finally {
    process.noAsar = previous
  }
}

/** Minimal ZIP reader (stored/deflate, zip64, unix modes and symlinks): enough for Electron releases. */
export function extractZip(zipPath, dest) {
  return withoutAsar(() => extractZipRaw(zipPath, dest))
}

function extractZipRaw(zipPath, dest) {
  const fd = openSync(zipPath, 'r')
  try {
    const size = fstatSync(fd).size
    const read = (pos, len) => {
      const b = Buffer.alloc(len)
      readSync(fd, b, 0, len, pos)
      return b
    }
    const tailLen = Math.min(size, 65557)
    const tail = read(size - tailLen, tailLen)
    let eocd = -1
    for (let i = tail.length - 22; i >= 0; i--)
      if (u32(tail, i) === 0x06054b50) {
        eocd = i
        break
      }
    if (eocd < 0) throw new Error('not a zip file')
    let count = u16(tail, eocd + 10)
    let cdSize = u32(tail, eocd + 12)
    let cdOff = u32(tail, eocd + 16)
    if (count === 0xffff || cdOff === 0xffffffff) {
      const loc = eocd - 20
      if (loc < 0 || u32(tail, loc) !== 0x07064b50) throw new Error('zip64 locator missing')
      const z64 = read(u64(tail, loc + 8), 56)
      if (u32(z64, 0) !== 0x06064b50) throw new Error('zip64 record missing')
      count = u64(z64, 32)
      cdSize = u64(z64, 40)
      cdOff = u64(z64, 48)
    }
    const cd = read(cdOff, cdSize)
    const root = resolve(dest)
    const links = []
    let p = 0
    for (let n = 0; n < count; n++) {
      if (u32(cd, p) !== 0x02014b50) throw new Error('bad central directory')
      const madeBy = u16(cd, p + 4) >> 8
      const method = u16(cd, p + 10)
      let csize = u32(cd, p + 20)
      let usize = u32(cd, p + 24)
      const nameLen = u16(cd, p + 28)
      const extraLen = u16(cd, p + 30)
      const commentLen = u16(cd, p + 32)
      const attr = u32(cd, p + 38)
      let local = u32(cd, p + 42)
      const name = cd.toString('utf8', p + 46, p + 46 + nameLen)
      const extra = cd.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen)
      for (let e = 0; e + 4 <= extra.length;) {
        const id = u16(extra, e)
        const len = u16(extra, e + 2)
        let q = e + 4
        if (id === 1) {
          if (usize === 0xffffffff) {
            usize = u64(extra, q)
            q += 8
          }
          if (csize === 0xffffffff) {
            csize = u64(extra, q)
            q += 8
          }
          if (local === 0xffffffff) {
            local = u64(extra, q)
            q += 8
          }
        }
        e += 4 + len
      }
      p += 46 + nameLen + extraLen + commentLen
      const out = resolve(root, name)
      if (out !== root && !out.startsWith(root + sep)) throw new Error('zip entry escapes destination: ' + name)
      if (name.endsWith('/')) {
        mkdirSync(out, { recursive: true })
        continue
      }
      const lh = read(local, 30)
      if (u32(lh, 0) !== 0x04034b50) throw new Error('bad local header: ' + name)
      const data = read(local + 30 + u16(lh, 26) + u16(lh, 28), csize)
      const body = method === 0 ? data : method === 8 ? inflateRawSync(data) : null
      if (!body) throw new Error(`unsupported compression ${method}: ${name}`)
      if (body.length !== usize) throw new Error('size mismatch: ' + name)
      mkdirSync(dirname(out), { recursive: true })
      const mode = madeBy === 3 ? (attr >>> 16) & 0o177777 : 0
      if ((mode & 0o170000) === 0o120000) {
        links.push([body.toString('utf8'), out])
        continue
      }
      writeFileSync(out, body)
      if (mode & 0o111 && process.platform !== 'win32') chmodSync(out, mode & 0o777)
    }
    for (const [target, at] of links) {
      if (process.platform === 'win32') continue
      const abs = resolve(dirname(at), target)
      if (abs !== root && !abs.startsWith(root + sep)) throw new Error('zip symlink escapes destination: ' + at)
      try {
        rmSync(at, { force: true })
      } catch {}
      symlinkSync(target, at)
    }
    return count
  } finally {
    closeSync(fd)
  }
}

// ---------------------------------------------------------------------------- runtime

/** Download, resume, verify and unpack the Electron runtime. */
export async function installRuntime({
  root = dataRoot(),
  version = ELECTRON_VERSION,
  mirrors = MIRRORS,
  platform = process.platform,
  arch = process.arch,
  onProgress,
  onState,
  signal,
  attempts = 3,
  retryDelayMs = 1000,
  timeoutMs = 30000
} = {}) {
  signal?.throwIfAborted()
  const name = assetName(version, platform, arch)
  if (!name) throw new Error(`no Electron build for ${platform}-${arch}`)
  const dir = join(root, 'runtime', name.replace(/\.zip$/, ''))
  const exe = electronExecutable(dir, platform)
  if (existsSync(join(dir, '.complete')) && existsSync(exe)) return exe
  mkdirSync(join(root, 'runtime'), { recursive: true })
  const zip = join(root, 'runtime', name + '.part')
  const identity = zip + '.sha256'
  const errors = []
  for (const mirror of mirrors) {
    const base = `${mirror}v${version}/`
    const source = new URL(base).hostname
    let want
    for (let attempt = 1; attempt <= attempts; attempt++) {
      signal?.throwIfAborted()
      try {
        onState?.({ source, attempt, phase: 'checksum', lastError: null })
        if (!want) {
          const sums = await downloadText(base + 'SHASUMS256.txt', signal, timeoutMs)
          want = sums
            .split('\n')
            .map((l) => l.trim().split(/\s+\*?/))
            .find((p) => p[1] === name)?.[0]
            ?.toLowerCase()
          if (!/^[a-f0-9]{64}$/.test(want ?? '')) {
            want = null
            throw new Error(`${name} not listed in SHASUMS256.txt`)
          }
        }
        // Resume only bytes belonging to the same release hash, even across mirrors/restarts.
        if (!existsSync(identity) || readFileSync(identity, 'utf8') !== want) {
          rmSync(zip, { force: true })
          writeFileSync(identity, want)
        }
        const alreadyComplete = existsSync(zip) && (await sha256(zip)) === want
        if (!alreadyComplete) {
          onState?.({ source, attempt, phase: 'download' })
          await downloadArchive(base + name, zip, { onProgress, signal, timeoutMs })
          onState?.({ phase: 'verify' })
          if ((await sha256(zip)) !== want) {
            rmSync(zip, { force: true })
            throw new Error(`checksum mismatch for ${name}`)
          }
        }
        signal?.throwIfAborted()
        onState?.({ phase: 'extract' })
        const tmp = dir + '.tmp'
        withoutAsar(() => {
          rmSync(tmp, { recursive: true, force: true })
          extractZipRaw(zip, tmp)
          if (!existsSync(electronExecutable(tmp, platform))) throw new Error('运行时压缩包中缺少 Electron 可执行文件')
          writeFileSync(join(tmp, '.complete'), `${name} ${want}\n`)
          rmSync(dir, { recursive: true, force: true })
          renameSync(tmp, dir)
        })
        rmSync(zip, { force: true })
        rmSync(identity, { force: true })
        onState?.({ phase: 'complete', lastError: null })
        return exe
      } catch (e) {
        signal?.throwIfAborted()
        const message = downloadError(e)
        errors.push(`${source} 第 ${attempt} 次：${message}`)
        onState?.({ phase: 'retry', lastError: message })
        // Keep partial data on network failure. SHA-256 still gates installation.
        if (attempt < attempts) await delay(retryDelayMs * attempt, undefined, { signal })
      }
    }
  }
  throw new Error(errors.join('\n') + '\n可重试续传，或安装 Windows 离线运行时包。')
}

// ---------------------------------------------------------------------------- manager

/**
 * Owns the overlay: runtime discovery/download, the overlay process (or in-process window), and
 * the message relay. All methods are safe to call repeatedly.
 */
export class DesktopOverlay {
  constructor({ config = {}, env = process.env, modelPath, log = () => {}, root = dataRoot(env) } = {}) {
    this.config = config
    this.env = env
    this.modelPath = modelPath
    this.log = log
    this.root = root
    this.child = null
    this.inproc = null
    this.running = false
    this.ready = false
    this.starting = null
    this.download = null // { received, total, error }
    this.abort = null
    this.lastExit = null
    this.events = [] // overlay → page events, with seq
    this.seq = 0
    this.size = 360
    this.lastGeometry = null
    this.tracking = null
  }

  /** Where the runtime comes from right now (no side effects). */
  runtime() {
    const custom = this.config.electron || this.env.DSH_WHALE_MATE_ELECTRON
    if (custom) return { kind: 'custom', path: custom, ready: existsSync(custom) }
    if (process.versions.electron && process.type === 'browser')
      return { kind: 'harness', path: process.execPath, ready: true }
    const name = assetName()
    if (!name) return { kind: 'none', path: null, ready: false }
    const dir = join(this.root, 'runtime', name.replace(/\.zip$/, ''))
    const exe = electronExecutable(dir)
    return {
      kind: 'download',
      path: exe,
      ready: existsSync(join(dir, '.complete')) && existsSync(exe),
      version: ELECTRON_VERSION,
      asset: name
    }
  }

  status(req) {
    const rt = this.runtime()
    const local = req ? isLoopback(req) : true
    const display = displayAvailable()
    const supported = rt.kind !== 'none' && display && local
    const reason = rt.kind === 'none' ? 'platform' : !display ? 'no-display' : !local ? 'remote' : null
    const since = Number(req?.query?.since ?? -1)
    return {
      version: VERSION,
      host: {
        platform: process.platform,
        arch: process.arch,
        node: process.versions.node,
        electron: process.versions.electron ?? null,
        processType: process.type ?? null,
        remote: req?.socket?.remoteAddress ?? null,
        pid: process.pid,
        ppid: process.ppid,
        runAsNode: this.env.ELECTRON_RUN_AS_NODE === '1',
        officialDesktopPid: officialDesktopPid(),
        overlayPid: this.child?.pid ?? null
      },
      supported,
      reason,
      runtime: { kind: rt.kind, ready: rt.ready, version: rt.version ?? null },
      download: this.download,
      running: this.running,
      ready: this.ready,
      tracking: this.tracking,
      anyWindow: this.anyWindow ?? null,
      lastExit: this.lastExit,
      seq: this.seq,
      events: this.events.filter((e) => e.seq > since)
    }
  }

  emit(name, data = {}) {
    this.events.push({ seq: ++this.seq, name, data, at: Date.now() })
    if (this.events.length > 50) this.events.splice(0, this.events.length - 50)
  }

  startDownload() {
    if (this.download && !this.download.error && !this.download.done) return
    const state = { received: 0, total: 0, error: null, done: false, phase: 'checksum' }
    this.download = state
    const abort = new AbortController()
    this.abort = abort
    // A cancelled writer must finish closing before a new attempt uses the same .part file.
    const previous = this.installTask
    const task = (async () => {
      await previous?.catch(() => {})
      abort.signal.throwIfAborted()
      await installRuntime({
        root: this.root,
        signal: abort.signal,
        onProgress: (received, total) => {
          Object.assign(state, { received, total })
        },
        onState: (update) => {
          Object.assign(state, update)
        }
      })
      if (this.download !== state || abort.signal.aborted) return
      state.done = true
      this.log('info', 'electron runtime installed')
      if (this.wantRun) await this.start({ size: this.size })
    })()
      .catch((e) => {
        if (this.download !== state || abort.signal.aborted) return
        state.error = downloadError(e)
        this.log('warn', 'electron download failed: ' + state.error)
      })
      .finally(() => {
        if (this.installTask === task) this.installTask = null
      })
    this.installTask = task
    return task
  }

  /** Start the overlay (downloading the runtime first if allowed). */
  async start({ size, download = false, modelPath } = {}) {
    if (size) this.size = size
    // The avatar picked in Settings (takes effect when the overlay process starts).
    if (modelPath) this.modelPath = modelPath
    this.wantRun = true
    if (this.running || this.starting) return this.starting
    const rt = this.runtime()
    if (!rt.ready) {
      if (rt.kind === 'download' && download) this.startDownload()
      else {
        this.lastExit = {
          reason: 'error',
          message:
            rt.kind === 'custom'
              ? '配置的 Electron 可执行文件不存在，请检查插件 electron 配置或 DSH_WHALE_MATE_ELECTRON。'
              : '桌面运行时尚未安装或当前平台不受支持。'
        }
        this.emit('error', this.lastExit)
      }
      return
    }
    this.starting = (async () => {
      this.lastExit = null
      this.ready = false
      if (rt.kind === 'harness') await this.startInProcess()
      else this.spawnOverlay(rt.path)
      this.running = true
      this.emit('started')
    })()
      .catch((e) => {
        this.running = false
        this.lastExit = { reason: 'error', message: String(e?.message ?? e) }
        this.log('warn', 'desktop overlay failed: ' + this.lastExit.message)
      })
      .finally(() => {
        this.starting = null
      })
    return this.starting
  }

  async startInProcess() {
    const electron = await import('electron')
    const { startOverlay } = createRequire(import.meta.url)(MAIN)
    this.inproc = startOverlay(electron.default ?? electron, {
      send: (m) => this.onOverlay(m),
      modelPath: this.modelPath,
      size: this.size
    })
    this.inproc.opened.catch((e) => this.onExit({ reason: 'error', message: String(e?.message ?? e) }))
  }

  spawnOverlay(exe) {
    const env = {
      ...process.env,
      WHALE_MATE_MODEL: this.modelPath,
      WHALE_MATE_SIZE: String(this.size),
      WHALE_MATE_DATA: join(this.root, 'overlay-data')
    }
    delete env.WHALE_MATE_HARNESS_PID
    const desktopPid = officialDesktopPid()
    if (desktopPid && process.platform === 'win32') env.WHALE_MATE_HARNESS_PID = String(desktopPid)
    this.tracking = null
    this.anyWindow = null
    // Harness Desktop runs this host as an Electron RunAsNode child with its own IPC channel:
    // none of that may leak into the overlay, which is a normal Electron app with its own channel.
    for (const k of [
      'ELECTRON_RUN_AS_NODE',
      'ELECTRON_NO_ATTACH_CONSOLE',
      'NODE_OPTIONS',
      'NODE_CHANNEL_FD',
      'NODE_CHANNEL_SERIALIZATION_MODE',
      'NODE_UNIQUE_ID'
    ])
      delete env[k]
    // Linux: a runtime unpacked without root cannot have a setuid chrome-sandbox, and many distros
    // block the user-namespace sandbox; the overlay only ever loads this plugin's own files from a
    // token-protected loopback URL, so run it unsandboxed there. Windows/macOS keep the sandbox.
    const args = process.platform === 'linux' ? ['--no-sandbox', APP] : [APP]
    const child = spawn(exe, args, { env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: false })
    this.child = child
    let tail = ''
    const keep = (d) => {
      tail = (tail + d).slice(-2000)
    }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    child.on('message', (m) => this.onOverlay(m))
    child.on('error', (e) => this.onExit({ reason: 'error', message: String(e?.message ?? e) }))
    child.on('exit', (code, signal) => {
      if (this.child === child)
        this.onExit(
          code === 0 || signal === 'SIGTERM'
            ? { reason: this.stopping ? 'stopped' : 'exited', code }
            : { reason: 'crashed', code, signal, message: tail.trim().split('\n').slice(-5).join('\n') }
        )
    })
  }

  onOverlay(m) {
    if (!m || typeof m !== 'object') return
    if (m.type === 'ready') {
      this.ready = true
      if (this.lastGeometry) this.send({ type: 'geometry', geometry: this.lastGeometry })
      this.emit('ready')
    } else if (m.type === 'event') {
      if (m.name === 'tracking') this.tracking = m.data
      if (m.name === 'any-window') {
        this.anyWindow = m.data
        return
      }
      if (m.name === 'exit') {
        this.emit('exit')
        this.stop('user')
        return
      }
      this.emit(String(m.name), m.data ?? {})
    } else if (m.type === 'debug') {
      this.onDebug?.(m)
    } else if (m.type === 'error' || m.type === 'log') {
      this.log('warn', 'overlay: ' + m.message)
      if (m.type === 'error' || m.level !== 'warn') this.emit('error', { message: String(m.message).slice(0, 500) })
      // The pet never came up (no WebGL, broken model…): close the window so the page shows her again.
      if (m.type === 'error' && !this.ready && this.running) {
        const message = String(m.message).split('\n')[0].slice(0, 300)
        this.stop('error')
        this.lastExit = { reason: 'error', message }
      }
    }
  }

  onExit(info) {
    this.child = null
    this.inproc = null
    this.running = false
    this.ready = false
    this.lastExit = info
    this.emit('stopped', info)
  }

  send(msg) {
    if (msg?.type === 'geometry') this.lastGeometry = msg.geometry
    if (this.inproc) this.inproc.receive(msg)
    else if (this.child?.connected) this.child.send(msg)
  }

  stop(reason = 'stopped') {
    this.wantRun = false
    this.abort?.abort()
    if (this.download && !this.download.done) this.download = null
    if (this.inproc) {
      this.inproc.close()
      this.onExit({ reason })
    }
    if (this.child) {
      this.stopping = true
      const c = this.child
      this.onExit({ reason })
      try {
        c.disconnect?.()
      } catch {}
      setTimeout(() => {
        try {
          c.kill()
        } catch {}
      }, 1500).unref?.()
      this.stopping = false
    }
  }
}

// ---------------------------------------------------------------------------- routes

function readJson(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(Object.assign(new Error('too large'), { status: 413 }))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
      } catch {
        reject(Object.assign(new Error('bad json'), { status: 400 }))
      }
    })
    req.on('error', reject)
  })
}

const PET_METHODS = new Set([
  'say',
  'setThinking',
  'streamReply',
  'finishReply',
  'noticeUserMessage',
  'expression',
  'action',
  'setSize',
  'recall',
  'setVisible',
  'openMotionMenu',
  'setFavorites',
  'playChoice'
])

/** Validate one page → overlay message; returns null for anything unexpected. */
export function sanitize(msg) {
  if (!msg || typeof msg !== 'object') return null
  if (msg.type === 'geometry') {
    const g = msg.geometry
    if (g === null) return { type: 'geometry', geometry: null }
    const num = (v) => (Number.isFinite(v) ? v : 0)
    const rect = (r) =>
      r && typeof r === 'object'
        ? { left: num(r.left), top: num(r.top), width: num(r.width), height: num(r.height) }
        : null
    if (!g || typeof g !== 'object') return null
    return {
      type: 'geometry',
      geometry: {
        screenX: num(g.screenX),
        screenY: num(g.screenY),
        outerWidth: num(g.outerWidth),
        outerHeight: num(g.outerHeight),
        innerWidth: num(g.innerWidth),
        innerHeight: num(g.innerHeight),
        dpr: num(g.dpr) || 1,
        home: rect(g.home),
        hidden: !!g.hidden
      }
    }
  }
  if (msg.type === 'cmd' && PET_METHODS.has(msg.method)) {
    const args = Array.isArray(msg.args)
      ? msg.args.slice(0, 3).map((a) => (typeof a === 'string' ? a.slice(0, 4000) : a))
      : []
    return { type: 'cmd', method: msg.method, args: JSON.parse(JSON.stringify(args)) }
  }
  if (msg.type === 'visible') return { type: 'visible', on: !!msg.on }
  return null
}

/** `${base}desktop/{status,start,stop,send}` — same auth fence as the asset routes, loopback only for control. */
export function mountDesktopRoutes(server, { base, reject, overlay, modelPath = () => null }) {
  const json = (res, status, body) => {
    const b = Buffer.from(JSON.stringify(body))
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': b.length
    })
    res.end(b)
  }
  const guard = (method, fn) => async (req, res) => {
    if (req.method !== method) {
      res.writeHead(405, { Allow: method })
      res.end()
      return
    }
    const denied = reject?.(req)
    if (denied) {
      res.writeHead(denied)
      res.end()
      return
    }
    try {
      if (method === 'POST' && !isLoopback(req))
        return json(res, 403, { error: 'desktop mode is only available on the machine running Harness' })
      await fn(req, res)
    } catch (e) {
      json(res, e?.status ?? 500, { error: String(e?.message ?? e) })
    }
  }
  const routes = {
    status: guard('GET', (req, res) => {
      const since = new URL(req.url ?? '', 'http://x').searchParams.get('since')
      json(res, 200, overlay.status({ socket: req.socket, query: { since } }))
    }),
    start: guard('POST', async (req, res) => {
      const body = await readJson(req)
      const size = Number(body.size)
      const model =
        typeof body.model === 'string' && /^[a-z][a-z0-9-]{0,40}$/.test(body.model) ? modelPath(body.model) : null
      await overlay.start({
        size: Number.isFinite(size) ? Math.min(640, Math.max(160, size)) : undefined,
        download: !!body.download,
        modelPath: model ?? undefined
      })
      json(res, 200, overlay.status(req))
    }),
    stop: guard('POST', async (req, res) => {
      await readJson(req)
      overlay.stop('stopped')
      json(res, 200, overlay.status(req))
    }),
    send: guard('POST', async (req, res) => {
      const body = await readJson(req)
      let n = 0
      for (const m of Array.isArray(body.messages) ? body.messages.slice(0, 64) : []) {
        const s = sanitize(m)
        if (s) {
          overlay.send(s)
          n++
        }
      }
      json(res, 200, { ok: true, forwarded: n, running: overlay.running, ready: overlay.ready })
    })
  }
  const disposers = Object.entries(routes).map(([name, handler]) =>
    server.register({ kind: 'exact', path: `${base}desktop/${name}`, handler })
  )
  return () => {
    for (const d of disposers.reverse()) d()
  }
}
