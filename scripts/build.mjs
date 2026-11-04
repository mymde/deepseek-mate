// Bundle the pet engine (with three.js and three-vrm) into one self-contained ES module,
// so the Harness page can import() it without an import map.
import { build } from 'esbuild'
import { copyFile, mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const publicDir = join(root, 'public')
await mkdir(publicDir, { recursive: true })

const result = await build({
  entryPoints: [join(root, 'src/pet/index.js')],
  bundle: true,
  format: 'esm',
  target: ['chrome110', 'firefox115', 'safari16'],
  minify: true,
  legalComments: 'eof',
  outfile: join(publicDir, 'pet.js'),
  metafile: true
})

// Source models are optional: the repository ships the built VRM files under public/,
// and the earlier whale-maid model is no longer part of the package (0.6.2+).
const models = [
  [
    process.env.WHALE_MATE_MODEL ?? join(root, '..', 'desktop-mate', 'assets', 'whale-maid.vrm'),
    join(publicDir, 'whale-maid.vrm')
  ],
  // DeepSeek Reset, re-exported by scripts/blender/export-deepseek-reset.py (credit: bilibili @hihihihi202).
  [
    process.env.DEEPSEEK_RESET_MODEL ?? join(root, '..', 'models', 'DeepSeek_Reset.vrm'),
    join(publicDir, 'deepseek-reset.vrm')
  ]
]
for (const [from, to] of models) {
  try {
    await stat(from)
    await copyFile(from, to)
  } catch {
    // No source model on this machine: keep the VRM already committed under public/.
  }
}

const out = result.metafile.outputs['public/pet.js'] ?? Object.values(result.metafile.outputs)[0]
console.log(`public/pet.js ${(out.bytes / 1024).toFixed(0)} KiB`)
