import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/video-editor/',
  plugins: [react()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg'] },
  server: { host: '0.0.0.0', port: 5173, strictPort: true },
})
