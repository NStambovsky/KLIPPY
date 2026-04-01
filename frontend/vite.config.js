import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/upload': 'http://localhost:8000',
      '/transcribe': 'http://localhost:8000',
      '/transcript': 'http://localhost:8000',
      '/job': 'http://localhost:8000',
      '/export': 'http://localhost:8000',
      '/auto-clip': 'http://localhost:8000',
      '/clips': 'http://localhost:8000',
      '/clip': 'http://localhost:8000',
      '/file': 'http://localhost:8000',
      '/media': 'http://localhost:8000',
      '/clips-media': 'http://localhost:8000',
      '/health': 'http://localhost:8000',
      '/download-url': 'http://localhost:8000',
    },
  },
})
