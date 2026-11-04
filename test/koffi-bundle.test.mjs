// The plugin is installed by hand from a zip: no node_modules, no `npm install`. koffi (needed on
// Windows for window tracking) must ship inside desktop/, and its absence must never kill the overlay.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const root = new URL('..', import.meta.url).pathname
const BIN = join(root, 'desktop/vendor/koffi/build/koffi/win32_x64/koffi.node')

test('bundled win32-x64 koffi binary is the published 3.1.0 x64 Node-API module', () => {
  const b = readFileSync(BIN)
  assert.equal(b.toString('latin1', 0, 2), 'MZ')
  const pe = b.readUInt32LE(0x3c)
  assert.equal(b.toString('latin1', pe, pe + 4), 'PE\0\0')
  assert.equal(b.readUInt16LE(pe + 4), 0x8664, 'x64')
  assert.ok(b.includes('napi_register_module_v1'))
  assert.equal(createHash('sha256').update(b).digest('hex'), 'f83df5e836a3d7cdffff9ed2ae1300c2e67225892df94930775be533b21e619b')
  assert.equal(require('../desktop/vendor/koffi/package.json').version, '3.1.0')
})

test('npm package (and so the zip) carries the bundled koffi', () => {
  const [pack] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8' }))
  const files = new Set(pack.files.map(f => f.path))
  for (const f of ['desktop/koffi.cjs', 'desktop/vendor/koffi/index.cjs', 'desktop/vendor/koffi/src/koffi/index.cjs', 'desktop/vendor/koffi/src/koffi/src/static.cjs', 'desktop/vendor/koffi/build/koffi/win32_x64/koffi.node', 'desktop/vendor/koffi/LICENSE.txt']) assert.ok(files.has(f), f)
  assert.equal(require('../package.json').dependencies?.koffi, undefined, 'no runtime npm dependency left to install')
})

test('bundled loader is the one used when it can load', { skip: `${process.platform}-${process.arch}` !== 'linux-x64' && 'dev check uses the linux-x64 binary from node_modules' }, () => {
  const koffi = require('../desktop/koffi.cjs').loadKoffi()
  assert.equal(typeof koffi.load, 'function')
  assert.ok(Object.keys(require.cache).some(k => k.includes('/desktop/vendor/koffi/src/koffi/index.cjs')))
})

test('without any usable koffi the trackers report an error instead of throwing', () => {
  // A copy of desktop/ with no node_modules above it, like a plugin folder unpacked from the zip.
  const dir = mkdtempSync(join(tmpdir(), 'whale-nokoffi-'))
  cpSync(join(root, 'desktop'), join(dir, 'desktop'), { recursive: true })
  if (process.platform === 'win32') return // the bundled binary loads there
  const { trackHarnessWindow } = require(join(dir, 'desktop/harness-window.cjs'))
  const errors = []
  const stop = trackHarnessWindow({ pid: 1, screen: {}, onChange: () => assert.fail('no geometry without a reader'), onError: e => errors.push(e.message) })
  assert.equal(typeof stop, 'function')
  assert.match(errors[0], /koffi/)
  assert.throws(() => require(join(dir, 'desktop/windows.cjs')).createWin32Lister(), /koffi/)
})
