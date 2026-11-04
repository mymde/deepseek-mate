// Bundle the pet engine (with three.js and three-vrm) into one self-contained ES module,
// so the Harness page can import() it without an import map.
import { build } from 'esbuild'
import { copyFile, mkdir, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
await mkdir(root + 'public', { recursive: true })
const result = await build({
  entryPoints: [root + 'src/pet/index.js'],
  bundle: true,
  format: 'esm',
  target: ['chrome110', 'firefox115', 'safari16'],
  minify: true,
  legalComments: 'eof',
  outfile: root + 'public/pet.js',
  metafile: true,
})
const model = process.env.WHALE_MATE_MODEL ?? root + '../desktop-mate/assets/whale-maid.vrm'
try { await stat(root + 'public/whale-maid.vrm') } catch { await copyFile(model, root + 'public/whale-maid.vrm') }
// Default avatar: DeepSeek Reset, re-exported by scripts/blender/export-deepseek-reset.py (credit: bilibili @hihihihi202).
const reset = process.env.DEEPSEEK_RESET_MODEL ?? root + '../models/DeepSeek_Reset.vrm'
try { await stat(reset); await copyFile(reset, root + 'public/deepseek-reset.vrm') } catch {}
const out = result.metafile.outputs['public/pet.js'] ?? Object.values(result.metafile.outputs)[0]
console.log(`public/pet.js ${(out.bytes / 1024).toFixed(0)} KiB`)
