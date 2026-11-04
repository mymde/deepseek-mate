// Renders the Settings model card (public/thumbs/<id>.png, upper body) and the round head avatar
// used as her icon (public/thumbs/avatar-raw.png, masked to a circle afterwards); transparent background. Usage: node scripts/render-thumbs.mjs
import { chromium } from '/home/ubuntu/tools/pw/node_modules/playwright-core/index.mjs'
import { serve } from './serve.mjs'
import { fileURLToPath } from 'node:url'
const out = fileURLToPath(new URL('../public/thumbs/', import.meta.url))
const server = await serve()
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
for (const id of ['deepseek-reset']) {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 1 })
  await page.goto(`http://127.0.0.1:${server.address().port}/test/harness.html?model=../public/${id}.vrm`)
  await page.waitForFunction(() => window.__loaded === true, null, { timeout: 120000 })
  await page.addStyleTag({ content: 'html,body,main,.msgs,.msg,.composer{background:transparent!important;border:0!important;box-shadow:none!important;color:transparent!important} textarea,.msg{visibility:hidden}' })
  await page.evaluate(() => { const p = window.pet; p.setSize(820); p.nextIdle = 1e9; p.perch = null; p.anchor = { x: 450, y: 1390 }; p.setLoc('stand', true); p.expression(window.__thumbFace ?? 'happy', window.__thumbFaceW ?? 1, 60) })
  await page.waitForTimeout(5000)
  const clip = await page.evaluate(() => { const p = window.pet; const h = p.headScreen; return { x: Math.round(h.x - 150), y: Math.max(0, Math.round(h.y - 120)), width: 300, height: 360 } })
  await page.screenshot({ path: out + id + '.png', clip, omitBackground: true })
  // Avatar: eyes open, a soft smile, head filling the circle.
  await page.evaluate(() => { const p = window.pet; p.face.clearHolds?.(); p.expression('relaxed', 0.35, 60); p.face.blinkT = -1; p.face.nextBlink = 1e9 })
  await page.waitForTimeout(1500)
  const head = await page.evaluate(() => { const h = window.pet.headScreen; return { x: Math.round(h.x - 80), y: Math.max(0, Math.round(h.y - 95)), width: 160, height: 160 } })
  await page.screenshot({ path: out + 'avatar-raw.png', clip: head, omitBackground: true })
  await page.close()
  console.log('wrote', id)
}
await browser.close(); server.close()
