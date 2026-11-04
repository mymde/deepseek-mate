// End-to-end desktop mode inside a real Harness Web UI whose host has a display (e.g. Xvfb).
// Usage: DISPLAY=:77 node scripts/check-dsh-desktop.mjs <dsh url with ?token=> <outDir>
import { chromium, executablePath } from './browser.mjs'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const [url, out = 'test/shots/dsh-desktop'] = process.argv.slice(2)
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({
  executablePath,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.type() + ': ' + m.text())
})
const results = []
const check = (name, ok, info) => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, info === undefined ? '' : JSON.stringify(info))
}
const status = () =>
  page.evaluate(async () => await fetch(new URL('whale-mate/desktop/status', document.baseURI)).then((r) => r.json()))
const until = async (fn, ms = 60000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await fn()) return true
    await page.waitForTimeout(300)
  }
  return false
}
const desktopShot = (name) => {
  execFileSync('python3', [
    '-I',
    fileURLToPath(new URL('./xwd-png.py', import.meta.url)),
    process.env.DISPLAY,
    `${out}/${name}.png`
  ])
}

await page.goto(url)
await page.waitForFunction(() => !!window.__whaleMate, null, { timeout: 120000 })
const cont = page.getByRole('button', { name: /Continue|继续/ })
if (await cont.count()) {
  await cont.first().click()
  await page.waitForTimeout(800)
}
await page.waitForTimeout(2500)
let st = await status()
if (st.running) {
  // leftover from an earlier run: start from the in-page state
  await page.evaluate(async () =>
    fetch(new URL('whale-mate/desktop/stop', document.baseURI), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    })
  )
  await until(() => page.evaluate(() => window.__whaleMate.suspended === false), 8000)
  await page.waitForTimeout(1500)
  st = await status()
}
check('host reports desktop mode available', st.supported === true && st.runtime.ready, {
  reason: st.reason,
  runtime: st.runtime
})

// Right-click her → 切换到桌面模式
const a = await page.evaluate(() => ({ ...window.__whaleMate.anchor }))
await page.mouse.move(a.x, a.y - 70)
await page.waitForTimeout(300)
await page.mouse.click(a.x, a.y - 70, { button: 'right' })
await page.waitForTimeout(300)
const item = page.locator('.whale-mate__menu [data-item="mode"]')
check('right-click wheel offers 桌面模式', (await item.count()) === 1)
await item.click()
check('overlay comes up', await until(async () => (await status()).ready), (await status()).lastExit)
check('in-page pet steps aside', await until(() => page.evaluate(() => window.__whaleMate.suspended === true), 5000))
await page.waitForTimeout(4000)
desktopShot('1-on-desktop')

const box = page.locator('[contenteditable="true"], textarea').first()
await box.click()
await page.keyboard.type('你好呀，你是谁？')
await page.keyboard.press('Enter')
await page.waitForTimeout(9000)
desktopShot('2-reply-bubble')
await box.click()
await page.keyboard.type('跳个舞吧！')
await page.keyboard.press('Enter')
await page.waitForTimeout(6000)
desktopShot('3-dance')
await page.screenshot({ path: `${out}/page.png` })

// Settings → 希可儿mate → 回到 Harness 窗口里
await page
  .evaluate(() => localStorage.getItem('dsh-whale-mate.desktop'))
  .then((v) => check('desktop mode remembered', v === '1'))
const more = page.getByText(/^(More|更多)$/).last()
if (await more.count()) {
  await more.click()
  await page.waitForTimeout(600)
}
const settings = page.getByText(/^(设置|Settings)$/).first()
if (await settings.count()) {
  await settings.click()
  await page.waitForTimeout(800)
  const sec = page.getByText('希可儿mate').first()
  if (await sec.count()) {
    await sec.click()
    await page.waitForTimeout(800)
  }
  await page.screenshot({ path: `${out}/settings.png` })
  const back = page.getByRole('radio', { name: /窗口模式/ })
  check('settings shows the desktop-mode controls', (await back.count()) === 1)
  if (await back.count()) await back.click()
} else check('found the settings button', false)
check('overlay closes', await until(async () => !(await status()).running, 10000))
check(
  'in-page pet returns',
  await until(
    () => page.evaluate(() => window.__whaleMate.suspended === false && window.__whaleMate.state().visible),
    5000
  )
)
check('no page errors', errors.length === 0, errors)
await browser.close()
console.log(`${results.filter(Boolean).length}/${results.length} passed`)
process.exit(results.every(Boolean) ? 0 : 1)
