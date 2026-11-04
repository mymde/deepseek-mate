import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync, rmSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { downloadArchive, downloadText, downloadError } from '../lib/runtime-download.js'
import { installRuntime, assetName, DesktopOverlay, electronExecutable } from '../lib/desktop.js'

async function fixture(t, handler) {
  const root = mkdtempSync(join(tmpdir(), 'whale-download-'))
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => {
    server.closeAllConnections()
    server.close()
    rmSync(root, { recursive: true, force: true })
  })
  return { root, file: join(root, 'partial'), base: `http://127.0.0.1:${server.address().port}/` }
}

test('connection drop retains bytes and the next request resumes the exact offset', async (t) => {
  const body = Buffer.alloc(128 * 1024, 81)
  let count = 0,
    range
  const f = await fixture(t, (req, res) => {
    if (++count === 1) {
      res.writeHead(200, { 'content-length': body.length })
      res.write(body.subarray(0, 8192))
      setTimeout(() => res.destroy(), 40)
    } else {
      range = req.headers.range
      const offset = Number(range.match(/\d+/)[0])
      res.writeHead(206, {
        'content-range': `bytes ${offset}-${body.length - 1}/${body.length}`,
        'content-length': body.length - offset
      })
      res.end(body.subarray(offset))
    }
  })
  await assert.rejects(downloadArchive(f.base, f.file))
  const offset = statSync(f.file).size
  assert.equal(offset, 8192)
  await downloadArchive(f.base, f.file)
  assert.equal(range, `bytes=${offset}-`)
  assert.deepEqual(readFileSync(f.file), body)
})

test('a mirror ignoring Range safely replaces partial data', async (t) => {
  const f = await fixture(t, (req, res) => res.end('complete'))
  writeFileSync(f.file, 'old')
  await downloadArchive(f.base, f.file)
  assert.equal(readFileSync(f.file, 'utf8'), 'complete')
})

test('incorrect Content-Range is refused without appending bytes', async (t) => {
  const f = await fixture(t, (req, res) => {
    res.writeHead(206, { 'content-range': 'bytes 0-3/4' })
    res.end('oops')
  })
  writeFileSync(f.file, 'old')
  await assert.rejects(downloadArchive(f.base, f.file), /范围无效/)
  assert.equal(readFileSync(f.file, 'utf8'), 'old')
})

test('an unsatisfiable Range clears stale data so a retry can start from zero', async (t) => {
  const ranges = []
  const f = await fixture(t, (req, res) => {
    ranges.push(req.headers.range)
    if (req.headers.range) {
      res.writeHead(416)
      res.end()
    } else res.end('complete')
  })
  writeFileSync(f.file, 'stale-oversized-file')
  await assert.rejects(downloadArchive(f.base, f.file), /416/)
  await downloadArchive(f.base, f.file)
  assert.deepEqual(ranges, ['bytes=20-', undefined])
  assert.equal(readFileSync(f.file, 'utf8'), 'complete')
})

test('idle timeout bounds stalled responses and keeps downloaded data', async (t) => {
  const f = await fixture(t, (req, res) => {
    res.writeHead(200, { 'content-length': 100 })
    res.write('partial')
  })
  await assert.rejects(downloadArchive(f.base, f.file, { timeoutMs: 100 }), /等待超过/)
  assert.equal(readFileSync(f.file, 'utf8'), 'partial')
})

test('cancellation closes the writer, leaving bytes available for a retry', async (t) => {
  const f = await fixture(t, (req, res) => {
    res.writeHead(200, { 'content-length': 100 })
    res.write('partial')
  })
  const abort = new AbortController()
  await assert.rejects(
    downloadArchive(f.base, f.file, {
      signal: abort.signal,
      onProgress: (r) => {
        if (r) abort.abort()
      }
    }),
    { name: 'AbortError' }
  )
  assert.equal(readFileSync(f.file, 'utf8'), 'partial')
  rmSync(f.file) // Closed handles are essential on Windows.
})

test('file errors reject cleanly instead of hanging on a drain event', async (t) => {
  const f = await fixture(t, (req, res) => res.end('body'))
  await assert.rejects(downloadArchive(f.base, join(f.root, 'missing', 'file')), { code: 'ENOENT' })
})

test('checksum requests also time out and error causes retain network codes', async (t) => {
  const f = await fixture(t, () => {})
  await assert.rejects(downloadText(f.base, undefined, 80), /等待超过/)
  const cause = new AggregateError([
    Object.assign(new Error(), { code: 'ECONNRESET' }),
    Object.assign(new Error(), { code: 'ETIMEDOUT' })
  ])
  assert.equal(downloadError(new Error('fetch failed', { cause })), 'fetch failed [ECONNRESET, ETIMEDOUT]')
})

function zipFixture(root) {
  const file = join(root, 'fixture.zip')
  execFileSync('python3', [
    '-I',
    '-c',
    'import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],"w") as z: z.writestr("electron.exe", b"fixture-runtime")',
    file
  ])
  const body = readFileSync(file)
  return { body, hash: createHash('sha256').update(body).digest('hex') }
}

test('installation retries, falls back to another source and verifies before marking ready', async (t) => {
  let archive,
    hits = 0
  const name = assetName('44.10.2', 'win32', 'x64')
  const f = await fixture(t, (req, res) => {
    if (req.url.startsWith('/bad/')) {
      hits++
      res.writeHead(503)
      return res.end()
    }
    if (req.url.endsWith('.txt')) return res.end(`${archive.hash} *${name}\n`)
    res.end(archive.body)
  })
  archive = zipFixture(f.root)
  const states = []
  const exe = await installRuntime({
    root: f.root,
    platform: 'win32',
    arch: 'x64',
    mirrors: [f.base + 'bad/', f.base + 'good/'],
    attempts: 2,
    retryDelayMs: 1,
    onState: (s) => states.push(s.phase)
  })
  assert.equal(hits, 2)
  assert.equal(readFileSync(exe, 'utf8'), 'fixture-runtime')
  assert.ok(readFileSync(join(exe, '..', '.complete'), 'utf8').includes(archive.hash))
  assert.ok(states.includes('retry'))
  assert.ok(states.includes('verify'))
  assert.equal(states.at(-1), 'complete')
})

test('a mismatched archive never creates the completion marker and is removed', async (t) => {
  const name = assetName('44.10.2', 'win32', 'x64')
  const f = await fixture(t, (req, res) =>
    res.end(req.url.endsWith('.txt') ? `${'a'.repeat(64)} *${name}` : 'tampered')
  )
  await assert.rejects(
    installRuntime({ root: f.root, platform: 'win32', arch: 'x64', mirrors: [f.base], attempts: 1 }),
    /checksum mismatch/
  )
  assert.equal(existsSync(join(f.root, 'runtime', name.replace('.zip', ''), '.complete')), false)
  assert.equal(existsSync(join(f.root, 'runtime', name + '.part')), false)
})

test('a previously downloaded, verified archive installs without downloading it again', async (t) => {
  let archive,
    downloads = 0
  const name = assetName('44.10.2', 'win32', 'x64')
  const f = await fixture(t, (req, res) => {
    if (req.url.endsWith('.txt')) res.end(`${archive.hash} *${name}`)
    else {
      downloads++
      res.end(archive.body)
    }
  })
  archive = zipFixture(f.root)
  // Cancel after receiving the full body, then retry as after an application restart.
  const abort = new AbortController()
  await assert.rejects(
    installRuntime({
      root: f.root,
      platform: 'win32',
      arch: 'x64',
      mirrors: [f.base],
      signal: abort.signal,
      onProgress: (r) => {
        if (r === archive.body.length) abort.abort()
      }
    }),
    { name: 'AbortError' }
  )
  assert.equal(existsSync(join(f.root, 'runtime', name + '.part')), true)
  await installRuntime({ root: f.root, platform: 'win32', arch: 'x64', mirrors: [f.base] })
  assert.equal(downloads, 1)
})

test('immediate cancel/re-enable cannot let the previous task overwrite current state', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'whale-cancel-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const runtime = join(root, 'runtime', assetName().replace('.zip', ''))
  mkdirSync(runtime, { recursive: true })
  writeFileSync(electronExecutable(runtime), 'fixture')
  writeFileSync(join(runtime, '.complete'), 'fixture')
  const overlay = new DesktopOverlay({ root })
  let starts = 0
  overlay.start = async () => {
    starts++
  }
  const previous = overlay.startDownload()
  const cancelledState = overlay.download
  overlay.stop()
  overlay.wantRun = true
  const next = overlay.startDownload()
  await Promise.all([previous, next])
  assert.equal(cancelledState.done, false)
  assert.notEqual(overlay.download, cancelledState)
  assert.equal(overlay.download.error, null)
  assert.equal(overlay.download.done, true)
  assert.equal(starts, 1)
})
