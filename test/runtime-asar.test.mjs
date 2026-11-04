import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The official Harness Desktop runs plugin hosts as ELECTRON_RUN_AS_NODE children, where fs treats
// "*.asar" paths as archives. Electron's own runtime zip contains resources/default_app.asar.
// Set WHALE_MATE_TEST_ELECTRON to any Electron executable (or a real default_app.asar is used).
const electron = process.env.WHALE_MATE_TEST_ELECTRON
test(
  'runtime installs under Electron RunAsNode despite default_app.asar',
  { skip: !electron || !existsSync(electron) ? 'set WHALE_MATE_TEST_ELECTRON' : false },
  () => {
    const root = mkdtempSync(join(tmpdir(), 'whale-asar-'))
    try {
      const asar = join(electron, '..', 'resources', 'default_app.asar')
      const zip = join(root, 'rt.zip')
      execFileSync('python3', [
        '-I',
        '-c',
        'import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_DEFLATED) as z:\n z.write(sys.argv[2],"resources/default_app.asar"); z.writestr("electron.exe",b"x")',
        zip,
        asar
      ])
      const hash = createHash('sha256').update(readFileSync(zip)).digest('hex')
      const out = execFileSync(
        electron,
        [fileURLToPath(new URL('fixtures/install-under-electron.mjs', import.meta.url)), root, zip, hash],
        { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' }
      )
      const runs = out
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l))
      assert.equal(runs.length, 2, out)
      for (const r of runs) {
        assert.equal(r.ok, true, r.error)
        assert.ok(r.electron)
        assert.ok(r.asarBytes > 1000)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
)
