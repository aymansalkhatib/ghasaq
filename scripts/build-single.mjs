/*
 * Builds the whole game into ONE self-contained HTML file (scripts and styles inlined).
 *
 *   npm run build:single     → dist-single/ghasaq.html  (fonts from Google Fonts)
 */
import { build } from 'vite';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

process.env.SINGLE_FILE = '1';
await build({ logLevel: 'warn' });

const out = 'dist-single';
let html = readFileSync(join(out, 'index.html'), 'utf8');
const assets = join(out, 'assets');
const files = readdirSync(assets);

// inline the stylesheets
for (const f of files.filter((n) => n.endsWith('.css'))) {
  const css = readFileSync(join(assets, f), 'utf8');
  html = html.replace(new RegExp(`<link[^>]*href="\\./assets/${f.replace('.', '\\.')}"[^>]*>`), () => `<style>\n${css}\n</style>`);
}
// inline the module script (moved to the end of <body> so the markup exists when it runs)
for (const f of files.filter((n) => n.endsWith('.js'))) {
  const js = readFileSync(join(assets, f), 'utf8').replace(/<\/script/gi, '<\\/script');
  html = html.replace(new RegExp(`<script[^>]*src="\\./assets/${f.replace('.', '\\.')}"[^>]*></script>\\s*`), '');
  html = html.replace('</body>', () => `<script type="module">\n${js}\n</script>\n</body>`);
}
if (/href="\.\/assets\//.test(html) || /src="\.\/assets\//.test(html)) throw new Error('an asset was left out of the single file');
writeFileSync(join(out, 'ghasaq.html'), html);
console.log(`${out}/ghasaq.html  ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);
