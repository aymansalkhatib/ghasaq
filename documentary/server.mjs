/*
 * The game's Vite dev server for recording: fonts bundled (no network needed), and no hot reload,
 * so editing a file can never reload a page in the middle of a take.
 *
 *   node documentary/server.mjs [port]     (default 4176)
 */
import { createServer } from 'vite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.OFFLINE_FONTS = '1';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = +(process.argv[2] || 4176);
const server = await createServer({
  root,
  configFile: join(root, 'vite.config.js'),
  logLevel: 'warn',
  server: { port, strictPort: true, open: false, hmr: false, watch: null },
});
await server.listen();
console.log(`ghasaq documentary server on http://localhost:${port}/`);
