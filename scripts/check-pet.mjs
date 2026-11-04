// Headless visual check: drives the pet through its states and saves screenshots.
import { chromium } from '/home/ubuntu/tools/pw/node_modules/playwright-core/index.mjs'
import { mkdir } from 'node:fs/promises'
import { serve } from './serve.mjs'

const out = new URL('../test/shots/', import.meta.url).pathname
await mkdir(out, { recursive: true })
const server = await serve()
const url = `http://127.0.0.1:${server.address().port}/test/harness.html`
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1000, height: 720 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto(url)
await page.waitForFunction(() => window.__loaded === true, null, { timeout: 120000 })
const wait = (ms) => page.waitForTimeout(ms)
const shot = async (name) => { await page.screenshot({ path: out + name + '.png' }); console.log('shot', name, JSON.stringify(await page.evaluate(() => window.pet.state()))) }
const only = process.argv.slice(2)
const want = (n) => only.length === 0 || only.includes(n)

await wait(2500)
if (want('home')) await shot('01-home-sit')
if (want('talk')) { await page.evaluate(() => window.pet.say('你好呀！我是希可儿，今天想聊点什么？', { expression: 'happy' })); await wait(1200); await shot('02-talk') }
if (want('think')) { await page.evaluate(() => window.pet.setThinking(true)); await wait(1800); await shot('03-think'); await page.evaluate(() => window.pet.setThinking(false)) }
if (want('stream')) {
  await page.evaluate(async () => { const t = '好的，我来帮你看看。这个问题其实可以分成三步来解决：首先确认环境，然后检查配置，最后运行测试。'; for (let i = 1; i <= t.length; i += 3) { window.pet.streamReply(t.slice(0, i)); await new Promise((r) => setTimeout(r, 60)) } window.pet.finishReply(t) })
  await wait(400); await shot('04-reply-done')
}
if (want('wave')) { await page.evaluate(() => window.pet.action('wave')); await wait(900); await shot('05-wave') }
if (want('drag')) {
  const p = await page.evaluate(() => { const s = window.pet; return { x: s.headScreen.x, y: s.headScreen.y + s.size * 0.22 } })
  await page.mouse.move(p.x, p.y); await wait(200)
  await page.mouse.down(); await page.mouse.move(p.x - 60, p.y - 80, { steps: 6 }); await page.mouse.move(p.x - 260, p.y - 160, { steps: 10 }); await wait(250)
  await shot('06-drag')
  await page.mouse.up(); await wait(150); await shot('07-fall'); await wait(1800); await shot('08-landed-floor')
}
if (want('walk')) { await page.evaluate(() => window.pet.action('walk')); await wait(900); await shot('09-walk') }
if (want('side')) {
  await page.evaluate(() => { window.pet.action('home') }); await wait(2500)
  await page.evaluate(() => { window.pet.__debugYaw = 1.3 }); await wait(800); await shot('10-sit-side')
  await page.evaluate(() => { window.pet.__debugYaw = 0 })
}
if (want('dance')) { await page.evaluate(() => window.pet.action('dance')); await wait(1500); await shot('11-dance') }
console.log('errors', JSON.stringify(errors))
await browser.close()
server.close()
