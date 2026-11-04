// Exercise the actual client and context-menu click, with controlled Host failures/progress.
import { chromium } from '/home/ubuntu/tools/pw/node_modules/playwright-core/index.mjs'
import { serve } from './serve.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
const server = await serve()
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  page.on('pageerror', e => console.error('page:', e.message))
  page.on('console', m => { if (m.type() === 'error') console.error('console:', m.text()) })
  const initial = { supported: true, version: '0.5.2', runtime: { kind: 'download', ready: false, version: '44.10.2' }, running: false, ready: false, seq: 0, events: [] }
  let status = { ...initial }, starts = 0, scenario = 'download'
  const origin = `http://127.0.0.1:${server.address().port}`
  if (process.argv.includes('--diagnose-old')) await page.route('**/client/client.js', route => route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: execFileSync('tar', ['-xOf', new URL('../dsh-plugin-whale-mate-0.5.2.tgz', import.meta.url).pathname, 'package/client/client.js']) }))
  await page.route('**/whale-mate/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/desktop/start')) {
      starts++
      if (scenario === 'error') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'spawn EACCES' }) })
      status = { ...initial, download: { received: 1048576, total: 150 * 1048576, done: false, error: null } }
    }
    if (path.includes('/desktop/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(status) })
    if (path.endsWith('/model.json')) return route.fulfill({ contentType: 'application/json', body: '{}' })
    return route.continue({ url: origin + path.replace('/whale-mate/', '/public/').replace('model.vrm', 'deepseek-reset.vrm') })
  })
  await page.route('**/click-fixture', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><meta charset="utf-8"><body><textarea style="position:fixed;left:300px;bottom:60px;width:600px;height:120px"></textarea><script>
    const react = { createElement(){}, useSyncExternalStore(s,g){ return g() } };
    window.__ModuleLoader__ = { load(m) { m.factory(() => react).apply({effect(fn){ fn() },slots:{inject(){},register(){}}}) } };
    </script><script src="/client/client.js"></script></body>` }))
  await page.goto(origin + '/click-fixture')
  await page.waitForFunction(() => !!window.__whaleMate, null, { timeout: 60000 })
  const click = async () => {
    await page.evaluate(() => __whaleMate.openMenu(450, 120))
    await page.getByRole('menuitem', { name: '切换到桌面模式' }).click()
    await page.waitForTimeout(400)
  }
  await click()
  assert.equal(starts, 1)
  assert.equal(await page.locator('.whale-mate__menu').isVisible(), false)
  // No pop-up: she says how the switch is going in her bubble.
  const bubble = () => page.locator('.whale-mate__bubble').textContent()
  const says = (re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('.whale-mate__bubble')?.textContent ?? ''), re.source, { timeout: 15000 })
  await says(/准备桌面/)
  assert.equal(await page.locator('[data-whale-desktop-status]').count(), 0)
  console.log('PASS wheel click sends start; she reports the runtime download herself, no pop-up')
  status.download = { ...status.download, received: 75 * 1048576 }
  await says(/50%/)
  console.log('PASS download progress is spoken in her bubble')
  status.download = { ...status.download, error: 'registry.npmmirror.com 第 3 次：fetch failed [ECONNRESET]' }
  await says(/去不了桌面/)
  assert.match(await bubble(), /ECONNRESET/)
  console.log('PASS asynchronous runtime download failure is spoken')
  scenario = 'error'
  await click()
  await says(/spawn EACCES/)
  console.log('PASS failed start says the reason in the current view')
  assert.equal(await page.evaluate(() => __whaleMate.suspended), false)
  console.log('PASS failed start keeps the page character visible')
} finally { await browser.close(); server.close() }
