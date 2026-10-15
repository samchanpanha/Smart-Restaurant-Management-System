import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        // Split the vendored libs out of the app chunk so a code change to a
        // screen does not invalidate React/lucide in the browser cache.
        advancedChunks: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'icons', test: /node_modules[\\/]lucide-react[\\/]/ },
          ],
        },
      },
    },
    // Screens are split per route; the remaining app chunk is i18n phrases +
    // the four shift-critical screens kept eager for a fallback-free boot.
    chunkSizeWarningLimit: 800,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
