'use strict'
// koffi (MIT, https://koffi.dev) ships inside the plugin: plugin folders installed by hand have no
// node_modules, and the official Desktop does not run `npm install` for them. desktop/vendor/koffi
// holds koffi's JS loader plus the win32-x64 prebuilt binary from @koromix/koffi-win32-x64 3.1.0.
// An installed `koffi` package is used only when the bundled copy cannot load on this platform.
let cached = null
function loadKoffi() {
  if (cached) return cached
  let first
  try { cached = require('./vendor/koffi/index.cjs'); return cached } catch (error) { first = error }
  try { cached = require('koffi'); return cached } catch {}
  throw new Error(`无法加载 koffi（${process.platform}-${process.arch}）：${first.message}`)
}
module.exports = { loadKoffi }
