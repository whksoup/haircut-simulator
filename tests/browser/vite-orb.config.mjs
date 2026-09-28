import { defineConfig } from 'vite';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('../../', import.meta.url));
const evidence = resolve(root, 'docs/evidence/orthographic-ray-brush/browser');
async function sourceHashes() {
  const paths = ['index.html', 'public/models/head.glb'];
  async function walk(dir) {
    for (const item of await readdir(resolve(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${item.name}`;
      if (item.isDirectory()) await walk(path);
      else if (/\.(js|css|mjs|html)$/.test(path)) paths.push(path);
    }
  }
  await walk('src'); await walk('tests/browser');
  const hashes = {};
  for (const path of paths.sort()) hashes[path] = createHash('sha256').update(await readFile(resolve(root, path))).digest('hex');
  return hashes;
}
export default defineConfig({ root, server: { host: '127.0.0.1', port: 5176, strictPort: true }, plugins: [{
  name: 'local-orb-evidence',
  configureServer(server) {
    server.middlewares.use('/__orb_source', async (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(await sourceHashes()));
    });
    server.middlewares.use('/__orb_evidence', async (req, res) => {
      try {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
        const chunks = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 24 * 1024 * 1024) throw new Error('Evidence exceeds 24 MB');
          chunks.push(chunk);
        }
        const { name, data, png } = JSON.parse(Buffer.concat(chunks).toString());
        if (!/^[a-zA-Z0-9_-]+\.(json|png)$/.test(name)) throw new Error('Invalid artifact name');
        await mkdir(evidence, { recursive: true });
        await writeFile(resolve(evidence, name), png ? Buffer.from(png, 'base64') : JSON.stringify(data, null, 2));
        res.setHeader('Content-Type', 'application/json'); res.end('{"saved":true}');
      } catch (error) { res.statusCode = 400; res.end(String(error)); }
    });
  },
}] });
