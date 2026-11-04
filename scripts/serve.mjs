// Tiny static server for the harness page (tests only).
import { createServer } from 'node:http'
import { createReadStream, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url))
const types = { '.html': 'text/html', '.js': 'text/javascript', '.vrm': 'model/gltf-binary', '.png': 'image/png' }
export function serve(port = 0) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '')
      const file = join(root, path)
      try {
        const s = statSync(file)
        if (!s.isFile()) throw new Error()
        res.writeHead(200, {
          'content-type': types[extname(file)] ?? 'application/octet-stream',
          'content-length': s.size
        })
        createReadStream(file).pipe(res)
      } catch {
        res.writeHead(404)
        res.end()
      }
    })
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await serve(Number(process.argv[2] ?? 0))
  console.log(`http://127.0.0.1:${s.address().port}/test/harness.html`)
}
