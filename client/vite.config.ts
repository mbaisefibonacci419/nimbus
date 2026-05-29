import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/** Replace the CSP connect-src placeholder based on build mode. */
function cspPlugin(): Plugin {
  let apiOrigin = '';
  return {
    name: 'csp-connect-src',
    configResolved(config) {
      const env = loadEnv(config.mode, config.envDir || process.cwd(), '');
      apiOrigin = env.VITE_API_ORIGIN || env.VITE_API_BASE || '';
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const connectSrc = ctx.server
          ? `'self' http://localhost:3001${apiOrigin ? ` ${apiOrigin}` : ''}`
          : apiOrigin
            ? `'self' ${apiOrigin}`
            : "'self'";
        return html.replace(
          /connect-src\s+'self'[^;]*/,
          `connect-src ${connectSrc}`,
        );
      },
    },
  };
}

export default defineConfig({
  envDir: '..',
  plugins: [
    cspPlugin(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'icons/icon.svg',
        'icons/apple-touch-icon.png',
        'icons/favicon-32.png',
      ],
      manifest: {
        name: 'Nimbus — Free Tax Preparation',
        short_name: 'Nimbus',
        description: 'Free, private tax preparation that runs entirely in your browser.',
        theme_color: '#0F172A',
        background_color: '#0F172A',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        globPatterns: ['**/*.{js,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/assets\//],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/.*\.css$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'css-cache',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          syncfusion: [
            '@syncfusion/ej2-base',
            '@syncfusion/ej2-react-charts',
            '@syncfusion/ej2-react-circulargauge',
            '@syncfusion/ej2-react-pdfviewer',
            '@syncfusion/ej2-pdfviewer',
            '@syncfusion/ej2-pdf',
            '@syncfusion/ej2-pdf-data-extract',
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  optimizeDeps: {
    include: ['pdfjs-dist'],
  },
  worker: {
    format: 'es',
  },
});
