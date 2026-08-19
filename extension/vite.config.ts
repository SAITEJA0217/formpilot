import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import manifest from './manifest.json';
import path from 'path';

export default defineConfig(({ command, mode }) => {
  return {
    plugins: [
      tailwindcss(),
      react(),
      crx({ manifest }),
      {
        name: 'strip-crossorigin',
        transformIndexHtml(html) {
          return html.replace(/ crossorigin/g, '');
        }
      }
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      modulePreload: false,
    },
  };
});
