import { createReadStream, existsSync, statSync, rmSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { createHash } from 'node:crypto'

// Keep network causes (fetch's message alone is usually just "fetch failed").
export function downloadError(error) {
  const codes = new Set()
  const seen = new Set()
  function visit(e) {
    if (!e || seen.has(e)) return
    seen.add(e)
    if (e.code) codes.add(String(e.code))
    visit(e.cause)
    for (const child of e.errors ?? []) visit(child)
  }
  visit(error)
  return `${error?.message ?? error}${codes.size ? ' [' + [...codes].join(', ') + ']' : ''}`
}

export async function sha256(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

// Deadline resets after each body chunk, so slow downloads can take as long as needed.
function requestDeadline(signal, timeoutMs) {
  const controller = new AbortController()
  let timer
  const reset = () => {
    clearTimeout(timer)
    timer = setTimeout(() => controller.abort(new Error(`下载连接或数据等待超过 ${timeoutMs / 1000} 秒`)), timeoutMs)
  }
  reset()
  return {
    signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
    reset,
    close: () => clearTimeout(timer),
  }
}

export async function downloadText(url, signal, timeoutMs = 30000) {
  const deadline = requestDeadline(signal, timeoutMs)
  try {
    const res = await fetch(url, { signal: deadline.signal, redirect: 'follow' })
    if (!res.ok) { await res.body?.cancel(); throw new Error(`HTTP ${res.status}`) }
    return await res.text()
  } catch (e) {
    throw deadline.signal.aborted ? deadline.signal.reason : e
  } finally { deadline.close() }
}

/** Append only when the server confirms the exact offset. A 200 response restarts safely. */
export async function downloadArchive(url, file, { onProgress, signal, timeoutMs = 30000 } = {}) {
  const deadline = requestDeadline(signal, timeoutMs)
  let fd, res
  try {
    let offset = existsSync(file) ? statSync(file).size : 0
    const headers = { 'Accept-Encoding': 'identity' }
    if (offset) headers.Range = `bytes=${offset}-`
    res = await fetch(url, { headers, signal: deadline.signal, redirect: 'follow' })
    // A stale/oversized partial file cannot be resumed; let the next retry start cleanly.
    if (res.status === 416) rmSync(file, { force: true })
    if (![200, 206].includes(res.status) || !res.body) throw new Error(`HTTP ${res.status}`)
    const length = Number(res.headers.get('content-length')) || 0
    let total = length
    if (res.status === 206) {
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(res.headers.get('content-range') ?? '')
      if (!range || Number(range[1]) !== offset || Number(range[2]) < offset || Number(range[2]) + 1 !== Number(range[3])) {
        throw new Error('服务器返回的断点续传范围无效')
      }
      total = Number(range[3])
    } else offset = 0
    fd = await open(file, offset ? 'a' : 'w')
    let received = offset
    onProgress?.(received, total)
    deadline.reset()
    for await (const chunk of res.body) {
      deadline.reset()
      let written = 0
      while (written < chunk.length) {
        const result = await fd.write(chunk, written, chunk.length - written)
        if (!result.bytesWritten) throw new Error('写入运行时文件失败')
        written += result.bytesWritten
      }
      received += chunk.length
      onProgress?.(received, total)
    }
    if (total && received !== total) throw new Error(`下载不完整：${received}/${total} 字节`)
  } catch (e) {
    throw deadline.signal.aborted ? deadline.signal.reason : e
  } finally {
    deadline.close()
    await fd?.close()
    if (res?.body && !res.body.locked) await res.body.cancel().catch(() => {})
  }
}
