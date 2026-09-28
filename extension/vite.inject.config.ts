/**
 * Second build pass: the injectable engine bundle.
 *
 * `@crxjs/vite-plugin` content-hashes the files it emits, which is right for
 * manifest-declared scripts but useless for `chrome.scripting.executeScript`, which
 * needs a path known at compile time. This config emits the same content-script
 * source as a single self-contained IIFE at the fixed path `dist/injected/universal.js`.
 *
 * It runs after the main build with `emptyOutDir: false`, so it adds to `dist/`
 * rather than replacing it. Order matters and is encoded in the `build` script.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  define: {
    // The engine runs outside the extension's own page context; keep React in
    // production mode so it does not warn about a missing dev environment.
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    emptyOutDir: false,
    outDir: 'dist',
    target: 'es2022',
    minify: true,
    cssCodeSplit: false,
    lib: {
      entry: path.resolve(import.meta.dirname, 'src/content/index.tsx'),
      formats: ['iife'],
      name: 'FormPilotEngine',
      fileName: () => 'injected/universal.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        extend: true,
      },
    },
  },
});
