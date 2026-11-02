import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  server: { watch: { ignored: ['**/release/**', '**/tmp/**'] } },
  optimizeDeps: {
    include: ['pptxgenjs', 'pptx-browser'],
  },
  preview: {
    allowedHosts: ['occurrence-nose-marco-barrel.trycloudflare.com'],
  },
})
