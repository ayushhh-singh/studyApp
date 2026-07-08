import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false, // registered manually via virtual:pwa-register/react (see main.tsx) so we control the update-prompt UX
      registerType: 'prompt',
      devOptions: {
        enabled: false, // injectManifest + dev SSR reload don't mix well; test PWA behavior against `vite build && vite preview`
        type: 'module',
      },
      includeAssets: ['favicon.svg', 'offline.html', 'manifest.hi.webmanifest', 'pwa/*.png'],
      injectManifest: {
        // Precache the app shell + hashed JS/CSS/font assets. Fonts are
        // Fontsource woff2 files bundled as hashed assets by Vite, so they're
        // covered by the default asset globs already emitted to dist.
        globPatterns: ['**/*.{js,css,html,woff2,svg,png,webmanifest}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      manifest: {
        name: 'PrayasUP — UPPSC Exam Prep',
        short_name: 'PrayasUP',
        description:
          'AI answer-writing evaluation, PYQ practice, and syllabus-mapped study for UPPSC (UP PCS) aspirants.',
        lang: 'en',
        dir: 'ltr',
        start_url: '/en/dashboard',
        scope: '/',
        display: 'standalone',
        theme_color: '#2563EB',
        background_color: '#F7F9FC',
        icons: [
          { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/pwa/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/pwa/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    strictPort: true,
  },
  build: {
    modulePreload: {
      // Vite's default modulePreload conservatively preloads every shared
      // vendor chunk referenced by ANY lazy route, since this SPA has one
      // index.html for every route and can't know at build time which route
      // a visit will land on. That put vendor-charts (recharts, ~110KB — only
      // used by dashboard/profile/learn-trends) and vendor-motion (framer-
      // motion, ~40KB — used by dashboard/revision/notes) on the wire before
      // First Contentful Paint even on the public landing page, which uses
      // neither. Both still load fine as plain (non-preloaded) dynamic
      // imports the moment a route that needs them is actually visited.
      resolveDependencies: (_filename, deps) =>
        deps.filter((dep) => !dep.includes('vendor-charts') && !dep.includes('vendor-motion')),
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (/[\\/](react|react-dom|react-router|scheduler)[\\/]/.test(id)) return 'vendor-react'
          if (/[\\/]@tanstack[\\/](react-query|react-virtual|query-core)[\\/]/.test(id)) return 'vendor-query'
          if (/[\\/](radix-ui|cmdk|lucide-react|class-variance-authority|tailwind-merge|clsx)[\\/]/.test(id)) return 'vendor-ui'
          if (/[\\/]framer-motion[\\/]/.test(id)) return 'vendor-motion'
          if (/[\\/]recharts[\\/]/.test(id)) return 'vendor-charts'
          if (/[\\/](i18next|react-i18next)[\\/]/.test(id)) return 'vendor-i18n'
          if (/[\\/]@supabase[\\/]/.test(id)) return 'vendor-supabase'
          return undefined
        },
      },
    },
  },
})
