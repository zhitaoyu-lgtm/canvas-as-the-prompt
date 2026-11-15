import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

// Same build setup as the upstream BlockSuite playground, trimmed to one entry.
export default defineConfig({
  base: './',
  plugins: [wasm(), vanillaExtractPlugin()],
  esbuild: { target: 'es2018' },
  resolve: { extensions: ['.ts', '.js'] },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 8000,
    rollupOptions: {
      onwarn(w, d) { if (w.code && ['EVAL', 'SOURCEMAP_ERROR'].includes(w.code)) return; d(w); },
    },
  },
});
