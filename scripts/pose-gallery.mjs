// Freeze each locomotion state / gesture and capture front + side views around the character.
import { chromium, executablePath } from './browser.mjs'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { serve } from './serve.mjs'
const out = fileURLToPath(new URL('../test/shots/gallery/', import.meta.url))
await mkdir(out, { recursive: true })
const server = await serve()
const browser = await chromium.launch({
  executablePath,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
})
const page = await browser.newPage({ viewport: { width: 1000, height: 720 } })
await page.goto(`http://127.0.0.1:${server.address().port}/test/harness.html`)
await page.waitForFunction(() => window.__loaded === true, null, { timeout: 120000 })
await page.evaluate(() => {
  const p = window.pet
  p.idleBrain = () => {}
  p.updateLookOrig = p.updateLook
})
const items = (process.argv[2] ?? 'stand,sit,walk,drag,fall,land,g:wave,g:think,g:pat,g:cheer,g:bow,g:dance').split(',')
for (const item of items) {
  for (const [view, yaw] of [
    ['front', 0],
    ['side', Math.PI / 2]
  ]) {
    await page.evaluate(
      ({ item, yaw }) => {
        const p = window.pet
        p.gesture = null
        p.busy = false
        p.__debugYaw = yaw
        p.cursor.at = -1e9
        if (item.startsWith('g:')) {
          p.setLoc('stand', true)
          p.perch = null
          p.anchor = { x: 500, y: 700 }
          p.play(item.slice(2))
          p.gesture.duration = 1e9
        } else {
          p.perch = item === 'sit' ? { el: document.querySelector('.composer'), dx: 255 } : null
          p.anchor = { x: 500, y: item === 'drag' ? 420 : 700 }
          p.setLoc(item, true)
          if (item === 'fall') {
            p.vel = { x: 0, y: 0 }
            p.step = () => {}
          }
          if (item === 'drag') {
            p.step = () => {}
            p.dragVel = { x: 0, y: 0 }
          }
          if (item === 'walk') {
            p.walkTarget = 99999
          }
          if (item === 'land') {
            p.landT = 0.25
            p.step = () => {}
          }
        }
      },
      { item, yaw }
    )
    await page.waitForTimeout(1500)
    const clip = await page.evaluate(() => {
      const p = window.pet
      return {
        x: Math.max(0, p.boxRect.left),
        y: Math.max(0, p.boxRect.top),
        width: p.box.w,
        height: Math.min(p.box.h, 720 - Math.max(0, p.boxRect.top))
      }
    })
    await page.screenshot({ path: `${out}${item.replace(':', '-')}-${view}.png`, clip })
    await page.evaluate(() => {
      const p = window.pet
      delete p.step
    })
  }
}
await browser.close()
server.close()
