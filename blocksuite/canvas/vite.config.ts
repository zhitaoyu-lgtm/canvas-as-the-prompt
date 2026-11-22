import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

// Same build setup as the upstream BlockSuite playground, trimmed to one entry.
const built = new Date().toISOString().replace(/\D/g, '').slice(0, 14);   // when this copy was built (UTC), shown in the + panel
export default defineConfig({
  define: { __BUILT__: JSON.stringify(built) },
  base: './',
  plugins: [wasm(), vanillaExtractPlugin()],
  esbuild: { target: 'es2018' },
  resolve: { extensions: ['.ts', '.js'] },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 8000,
    // Inline sticker SVGs and stamp images as data URLs (keeps the published file count small).
    assetsInlineLimit: (file: string) => (/templates[\\/]stickers|assets[\\/]stamps|assets[\\/]check|assets[\\/]demo/.test(file) ? true : undefined),
    rollupOptions: {
      onwarn(w, d) { if (w.code && ['EVAL', 'SOURCEMAP_ERROR'].includes(w.code)) return; d(w); },
    },
  },
});
