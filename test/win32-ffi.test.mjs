import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWin32Reader } from '../desktop/harness-window.cjs'

test('real Koffi marshals HWND callback, DWORD output, UTF-16 class and signed DWM RECT', { skip: process.platform !== 'linux' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'whale-ffi-'))
  try {
    const library = join(dir, 'fixture.so')
    execFileSync('cc', ['-shared', '-fPIC', '-o', library, fileURLToPath(new URL('win32-ffi-fixture.c', import.meta.url))])
    const read = createWin32Reader({ user: library, dwm: library })
    assert.deepEqual(read(42), [{ id: '257', pid: 42, className: 'Chrome_WidgetWin_1', owned: false, visible: true, minimized: false,
      rect: { x: -1200, y: 450, width: 1200, height: 900 } }])
    assert.deepEqual(read(123), [])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
