import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {defineConfig} from 'vite';

const rootDir = import.meta.dirname ?? path.dirname(fileURLToPath(import.meta.url));

function isLocalInjectedBase(val: string | undefined): boolean {
  if (!val) return false;
  return /^(https?|wss?):\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?(\/.*)?$/i.test(val.trim());
}

export default defineConfig(() => {
  const defineOverrides: Record<string, string> = {};
  if (isLocalInjectedBase(process.env.VITE_API_BASE_URL)) {
    defineOverrides['import.meta.env.VITE_API_BASE_URL'] = JSON.stringify('');
  }
  if (isLocalInjectedBase(process.env.VITE_WS_BASE_URL)) {
    defineOverrides['import.meta.env.VITE_WS_BASE_URL'] = JSON.stringify('');
  }

  return {
    define: defineOverrides,
    build: {
      chunkSizeWarningLimit: 1600,
    },
    plugins: [
      react(),
      tailwindcss(),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(rootDir, 'dist');
          const srcAssets = path.resolve(rootDir, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(rootDir, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
