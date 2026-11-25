import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'inline',
      includeAssets: ['favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'Circuit Atlantique',
        short_name: 'Atlantique',
        description: 'Course automobile 3D à Cotonou. Jouable hors ligne.',
        lang: 'fr',
        display: 'standalone',
        orientation: 'landscape',
        theme_color: '#ff7a3c',
        background_color: '#2a1848',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        cacheId: 'circuit-atlantique-v8',
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,svg,png,jpg,jpeg,webp,hdr,glb,woff2}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ],
  server: { host: '127.0.0.1', port: 8734, strictPort: true },
  preview: { host: '127.0.0.1', port: 8735, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
})
