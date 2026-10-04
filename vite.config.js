import { defineConfig } from 'vite';

// SINGLE_FILE=1 bundles everything into one script (used by scripts/build-single.mjs)
const single = !!process.env.SINGLE_FILE;

export default defineConfig({
  // relative paths so the built game runs from any folder or host
  base: './',
  server: { port: 5173, open: true },
  preview: { port: 4173 },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2000,
    outDir: single ? 'dist-single' : 'dist',
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
