// Child script for runtime-asar.test.mjs: runs installRuntime inside Electron RunAsNode.
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { installRuntime, assetName } from '../../lib/desktop.js'
const [root, zip, hash] = process.argv.slice(2)
const name = assetName('44.10.2', 'win32', 'x64')
const body = readFileSync(zip)
const server = createServer((req, res) => res.end(req.url.endsWith('.txt') ? `${hash} *${name}\n` : body))
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}/`
try {
  // Twice: the second run must also replace an installed runtime containing an .asar file.
  for (let i = 0; i < 2; i++) {
    if (i) {
      const { rmSync } = await import('node:fs')
      rmSync(join(root, 'runtime', name.replace(/\.zip$/, ''), '.complete'))
    }
    const exe = await installRuntime({
      root,
      platform: 'win32',
      arch: 'x64',
      mirrors: [base],
      attempts: 1,
      retryDelayMs: 1
    })
    process.noAsar = true
    const asar = readFileSync(join(exe, '..', 'resources', 'default_app.asar'))
    process.noAsar = false
    console.log(JSON.stringify({ ok: true, electron: process.versions.electron ?? null, asarBytes: asar.length }))
  }
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: e.message }))
} finally {
  server.close()
}
