import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import process from 'node:process'

// https://vite.dev/config/
export default defineConfig(async ({ command }) => ({
  server: command === 'serve' && process.env.SHOPPING_ADMIN_ISOLATED_PROXY && /^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.SHOPPING_ADMIN_ISOLATED_PROXY)
    ? { host: '127.0.0.1', proxy: Object.fromEntries(['/api', '/auth/v1'].map(path => [path, { target: process.env.SHOPPING_ADMIN_ISOLATED_PROXY, changeOrigin: false }])) } : undefined,
  plugins: [react(), ...(command === 'serve' && process.env.VITE_SHOPPING_ADMIN_PREVIEW === '1'
    ? [(await import('./src/features/shopping/preview/catalogPreview.js')).shoppingPreviewPlugin()] : [])],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    include: ['src/**/*.test.{js,jsx}'],
  },
}))
