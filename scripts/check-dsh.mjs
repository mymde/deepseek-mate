// End-to-end check inside a real DeepSeek Harness Web UI (with scripts/mock-llm.mjs as the model).
// Usage: node scripts/check-dsh.mjs <dsh url with ?token=>
import { chromium, executablePath } from './browser.mjs'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const url = process.argv[2]
const out = fileURLToPath(new URL('../test/shots/dsh/', import.meta.url))
await mkdir(out, { recursive: true })
const browser = await chromium.launch({
  executablePath,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => {
  if (m.type() === 'error' || /whale-mate/.test(m.text())) errors.push(m.type() + ': ' + m.text())
})
const shot = async (n) => {
  await page.screenshot({ path: out + n + '.png' })
  const s = await page.evaluate(() => window.__whaleMate?.state())
  console.log(n, JSON.stringify(s))
}
await page.goto(url)
await page.waitForFunction(() => !!window.__whaleMate, null, { timeout: 120000 }).catch(() => {})
await page.waitForTimeout(3000)
await shot('01-loaded')
const cont = page.getByRole('button', { name: /Continue|继续/ })
if (await cont.count()) {
  await cont.first().click()
  await page.waitForTimeout(800)
}
await shot('01b-ready')
const box = page.locator('[contenteditable="true"], textarea').first()
if (await box.count()) {
  await box.click()
  await page.keyboard.type('你好呀，你是谁？')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(700)
  await shot('02-thinking-or-start')
  await page.waitForTimeout(1600)
  await shot('03-streaming')
  await page.waitForTimeout(4000)
  await shot('04-done')
  await box.click()
  await page.keyboard.type('跳个舞吧！')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(2500)
  await shot('05-dance-tool')
  await page.waitForTimeout(4000)
  await shot('06-after-dance')
} else console.log('no textarea found')
console.log('ERRORS', JSON.stringify(errors, null, 1))
await browser.close()
