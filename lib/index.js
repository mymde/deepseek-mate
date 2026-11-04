// Host half of dsh-plugin-whale-mate: serves the pet engine and model to the Web UI and
// registers the pet_* tools. The tools only acknowledge; the browser overlay watches the
// session stream for these calls and performs them, so no extra host→browser channel exists.
import { readdirSync, statSync, createReadStream, existsSync, openSync, readSync, closeSync, readFileSync } from 'node:fs'
import { join, extname, relative, isAbsolute, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DesktopOverlay, mountDesktopRoutes } from './desktop.js'

export const name = 'dsh-plugin-whale-mate'
export const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url))
export const BASE = '/whale-mate/'
/** Avatars shipped in public/. The first one present is the default. */
export const BUILTIN_MODELS = {
  'deepseek-reset': { file: 'deepseek-reset.vrm', name: 'DeepSeek Reset', thumb: 'thumbs/deepseek-reset.png', credit: '模型作者 B站 @hihihihi202 · 非商用' },
}

/** Avatars the Settings page offers: the bundled ones, plus a configured custom .vrm (served as model.vrm). */
export function modelChoices(resolved, root = PUBLIC_DIR) {
  const list = []
  for (const [id, b] of Object.entries(BUILTIN_MODELS)) {
    if (!existsSync(join(root, b.file))) continue
    list.push({ id, name: b.name, file: b.file, thumb: existsSync(join(root, b.thumb)) ? b.thumb : null, credit: b.credit, configured: !resolved.custom && resolved.path === join(root, b.file) })
  }
  if (resolved.custom) list.push({ id: 'custom', name: resolved.name, file: 'model.vrm', thumb: null, credit: '自定义模型', configured: true })
  return list
}

/** Host path for a model id picked in Settings (built-in id, or "custom" = the configured file). */
export function modelPathFor(id, resolved, root = PUBLIC_DIR) {
  if (id === 'custom') return resolved.custom ? resolved.path : null
  const b = Object.hasOwn(BUILTIN_MODELS, id) ? BUILTIN_MODELS[id] : null
  return b && existsSync(join(root, b.file)) ? join(root, b.file) : null
}
export const DEFAULT_MODEL = join(PUBLIC_DIR, Object.values(BUILTIN_MODELS).find((m) => existsSync(join(PUBLIC_DIR, m.file)))?.file ?? 'deepseek-reset.vrm')

export const EXPRESSIONS = ['neutral', 'happy', 'angry', 'sad', 'relaxed', 'surprised', 'blink']
export const ACTIONS = ['wave', 'nod', 'shake', 'cheer', 'bow', 'stretch', 'shy', 'dance', 'jump', 'sit', 'stand', 'walk', 'sleep', 'wake', 'home']
let motionLabels = ''
try {
  const clips = JSON.parse(readFileSync(join(PUBLIC_DIR, 'motions.json'), 'utf8')).clips
  for (const [id, clip] of Object.entries(clips)) {
    if (!/^[a-z][a-z0-9-]{0,79}$/.test(id) || ['constructor','prototype'].includes(id)) continue
    if (!ACTIONS.includes(id)) ACTIONS.push(id)
    motionLabels += ` ${id}: ${String(clip.label ?? id)};`
  }
} catch { /* Missing optional pack keeps procedural tools available. */ }

const MIME = { '.png': 'image/png', '.js': 'text/javascript; charset=utf-8', '.vrm': 'model/gltf-binary', '.json': 'application/json', '.md': 'text/plain; charset=utf-8' }

/** Read the credit-relevant VRM meta (0.x or 1.0) from a .vrm without loading the binary chunk. */
export function readVrmMeta(path) {
  let fd
  try {
    fd = openSync(path, 'r')
    const head = Buffer.alloc(20)
    readSync(fd, head, 0, 20, 0)
    if (head.toString('latin1', 0, 4) !== 'glTF') return null
    const len = head.readUInt32LE(12)
    if (len > 64 * 1024 * 1024) return null
    const json = Buffer.alloc(len)
    readSync(fd, json, 0, len, 20)
    const ext = JSON.parse(json.toString('utf8')).extensions ?? {}
    if (ext.VRMC_vrm?.meta) {
      const m = ext.VRMC_vrm.meta
      return { name: m.name, authors: m.authors ?? [], copyright: m.copyrightInformation ?? '', contact: m.contactInformation ?? '', commercialUsage: m.commercialUsage, creditNotation: m.creditNotation, licenseUrl: m.licenseUrl }
    }
    if (ext.VRM?.meta) {
      const m = ext.VRM.meta
      return { name: m.title, authors: m.author ? [m.author] : [], copyright: '', contact: m.contactInformation ?? '', commercialUsage: m.commercialUssageName, creditNotation: undefined, licenseUrl: m.otherLicenseUrl || m.licenseName }
    }
    return null
  } catch {
    return null
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/**
 * The avatar the overlay loads from `${BASE}model.vrm`. `config.model` (or DSH_WHALE_MATE_MODEL) is
 * either the built-in id (`deepseek-reset`) or an absolute path to a .vrm on the host.
 */
export function resolveModel(config = {}, env = process.env, warn = () => {}) {
  const wanted = config.model || env.DSH_WHALE_MATE_MODEL || ''
  const builtin = (id) => {
    const b = BUILTIN_MODELS[id]
    const path = join(PUBLIC_DIR, b.file)
    return existsSync(path) ? { path, name: config.modelName || b.name, custom: false, meta: readVrmMeta(path) } : null
  }
  if (wanted && BUILTIN_MODELS[wanted]) {
    const m = builtin(wanted)
    if (m) return m
    warn(`built-in model ${wanted} is not installed`)
  } else if (wanted) {
    if (!isAbsolute(wanted) || extname(wanted).toLowerCase() !== '.vrm') warn(`model must be a built-in id or an absolute path to a .vrm file, got ${wanted}`)
    else if (!existsSync(wanted) || !statSync(wanted).isFile()) warn(`model file not found: ${wanted}`)
    else {
      const meta = readVrmMeta(wanted)
      return { path: wanted, name: config.modelName || meta?.name || basename(wanted, extname(wanted)), custom: true, meta }
    }
  }
  for (const id of Object.keys(BUILTIN_MODELS)) {
    const m = builtin(id)
    if (m) return m
  }
  return { path: DEFAULT_MODEL, name: '希可儿', custom: false, meta: null }
}

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.isFile() ? [join(dir, e.name)] : []))
}

function fileHandler(file, reject, type) {
  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return }
    const denied = reject?.(req)
    if (denied) { res.writeHead(denied); res.end(); return }
    let s
    try { s = statSync(file) } catch { res.writeHead(404); res.end(); return }
    const etag = `"${s.size}-${Math.trunc(s.mtimeMs)}"`
    const headers = { 'Content-Type': type ?? MIME[extname(file)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache', ETag: etag }
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return }
    res.writeHead(200, { ...headers, 'Content-Length': s.size })
    if (req.method === 'HEAD') { res.end(); return }
    const stream = createReadStream(file)
    stream.on('error', () => res.destroy())
    res.on('close', () => stream.destroy())
    stream.pipe(res)
  }
}

function jsonHandler(value, reject) {
  const body = Buffer.from(JSON.stringify(value))
  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return }
    const denied = reject?.(req)
    if (denied) { res.writeHead(denied); res.end(); return }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Content-Length': body.length })
    res.end(req.method === 'HEAD' ? undefined : body)
  }
}

/**
 * One exact route per bundled file, plus `model.vrm` / `model.json` for the configured avatar.
 * No request-controlled paths.
 */
export function mountRoutes(server, { root = PUBLIC_DIR, reject, model = resolveModel() } = {}) {
  const disposers = []
  try {
    for (const file of files(root)) {
      const path = BASE + relative(root, file).split('\\').join('/')
      disposers.push(server.register({ kind: 'exact', path, handler: fileHandler(file, reject) }))
    }
    disposers.push(server.register({ kind: 'exact', path: BASE + 'model.vrm', handler: fileHandler(model.path, reject, MIME['.vrm']) }))
    let bytes = 0
    try { bytes = statSync(model.path).size } catch {}
    disposers.push(server.register({ kind: 'exact', path: BASE + 'model.json', handler: jsonHandler({ name: model.name, custom: model.custom, bytes, meta: model.meta ?? null }, reject) }))
    disposers.push(server.register({ kind: 'exact', path: BASE + 'models.json', handler: jsonHandler({ models: modelChoices(model, root) }, reject) }))
  } catch (e) {
    for (const d of disposers.reverse()) d()
    throw e
  }
  let disposed = false
  return () => { if (!disposed) { disposed = true; for (const d of disposers.reverse()) d() } }
}

/** Same fence the built-in host routes use: Host/Origin checks plus the login cookie. */
function rejector(ctx) {
  const connection = Reflect.get(ctx, 'connection')
  if (!connection?.requestRejection) return undefined
  return (req) => connection.requestRejection(req)
}

const OK = { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } }

export function toolDefinitions(defineTool) {
  const ok = (summary) => ({ schema: OK, render: (args) => [{ type: 'text', text: summary(args) }] })
  return [
    defineTool({
      name: 'pet_say',
      description: 'Make 希可儿, the desktop pet sitting on the Harness window, say a short line in her speech bubble (lip-synced). Your normal replies already appear in her bubble automatically; use this for a separate aside, a greeting, or a reaction. Keep it under 60 characters.',
      parameters: {
        text: { type: 'string', required: true, description: 'Plain text, no Markdown.' },
        expression: { type: 'string', enum: EXPRESSIONS, description: 'Optional face while speaking.' },
      },
      output: ok((a) => `希可儿：${a.text}`),
      async execute() { return { ok: true } },
    }),
    defineTool({
      name: 'pet_expression',
      description: 'Change the desktop pet\'s facial expression for a few seconds, to match the mood of the conversation.',
      parameters: {
        name: { type: 'string', required: true, enum: EXPRESSIONS },
        seconds: { type: 'number', description: 'How long to hold it, 1-30, default 4.' },
      },
      output: ok((a) => `表情：${a.name}`),
      async execute() { return { ok: true } },
    }),
    defineTool({
      name: 'pet_action',
      description: 'Make the desktop pet perform an action: wave, nod, shake (head), cheer, bow, stretch, shy, dance, jump, sit, stand, walk, sleep, wake, home (return to the chat input box). Bundled motions:' + motionLabels,
      parameters: { name: { type: 'string', required: true, enum: ACTIONS } },
      output: ok((a) => `动作：${a.name}`),
      async execute() { return { ok: true } },
    }),
  ]
}

export function apply(ctx, config = {}) {
  ctx.inject(['webServer', 'connection'], (host) => {
    const model = resolveModel(config, process.env, (m) => host.logger?.warn?.(`whale-mate: ${m}; using the bundled model`))
    const reject = rejector(host)
    host.effect(() => mountRoutes(host.webServer, { reject, model }), 'whale-mate: bundled pet assets')
    if (config.desktop === false) return
    host.effect(() => {
      const log = (level, m) => host.logger?.[level]?.(`whale-mate: ${m}`)
      const overlay = new DesktopOverlay({ config, modelPath: model.path, log })
      const off = mountDesktopRoutes(host.webServer, { base: BASE, reject, overlay, modelPath: (id) => modelPathFor(id, model) })
      return () => { off(); overlay.stop('host-stopped') }
    }, 'whale-mate: desktop overlay')
  })
  if (config.tools === false) return
  ctx.inject(['tools'], async (tctx) => {
    let defineTool
    try { ({ defineTool } = await import('@deepseek-ai/dsh-tools')) } catch { return }
    for (const tool of toolDefinitions(defineTool)) tctx.tools.register(tool)
  })
}
