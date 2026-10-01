import { defineConfig } from 'vite';

// SINGLE_FILE=1 bundles everything into one script (used by scripts/build-single.mjs)
const single = !!process.env.SINGLE_FILE;
// OFFLINE_FONTS=1 bundles the fonts instead of loading them from Google Fonts (the exe and apk builds)
const offline = !!process.env.OFFLINE_FONTS;

/** Swaps the Google Fonts links in index.html for the bundled font files. */
const offlineFonts = {
  name: 'offline-fonts',
  transformIndexHtml: {
    order: 'pre',
    handler: (html) => html
      .replace(/\s*<link rel="preconnect"[^>]*>/g, '')
      .replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/, '<link rel="stylesheet" href="/src/styles/fonts-offline.css" />'),
  },
};

export default defineConfig({
  // relative paths so the built game runs from any folder or host
  base: './',
  plugins: offline ? [offlineFonts] : [],
  server: { port: 5173, open: true },
  preview: { port: 4173 },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2000,
    outDir: single ? (offline ? 'dist-app' : 'dist-single') : 'dist',
    cssCodeSplit: !single,
    assetsInlineLimit: single ? 100000000 : 4096,
    rollupOptions: {
      output: single
        ? { inlineDynamicImports: true }
        : {
          manualChunks: {
            three: ['three'],
            physics: ['cannon-es'],
          },
        },
    },
  },
});
