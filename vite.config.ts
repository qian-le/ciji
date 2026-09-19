import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * base 使用 './'：兼容
 * - 本地静态预览
 * - GitHub Pages 子路径 https://user.github.io/ciji/
 * 路由采用 hash（#/auth/callback），无需服务端 rewrite。
 */
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/icon.svg'],
      manifest: {
        name: '词迹',
        short_name: '词迹',
        description: '墨墨学习之后的分析、语境与二次记忆',
        lang: 'zh-CN',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#f6f7fb',
        theme_color: '#6c6fe8',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
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
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,json}'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // MiMo / 墨墨 API 不缓存，离线时由业务层提示
            urlPattern: ({ url }) =>
              url.hostname.includes('xiaomimimo') ||
              url.hostname.includes('maimemo') ||
              url.hostname.includes('accounts.maimemo'),
            handler: 'NetworkOnly',
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
  },
})
