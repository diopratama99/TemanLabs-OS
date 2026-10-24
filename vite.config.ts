import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // `npm run dev` proxies the API to a TemanLabsOS server: TEMANLABS_SERVER from .env.local
  // (e.g. http://my-server:7700), else one on this machine. `npm run dev:mock` needs no server.
  const target = loadEnv(mode, '.', '').TEMANLABS_SERVER || 'http://localhost:7700'
  const origin = new URL(target).origin
  return {
    plugins: [react()],
    build: {
      // Monaco (the code editor) is one large, lazily loaded chunk by design.
      chunkSizeWarningLimit: 5000,
    },
    server: {
      host: true,
      port: 5173,
      // The server refuses requests whose Origin isn't its own host; through the proxy the
      // browser's Origin is this dev server, so it's replaced with the server's.
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
          headers: { origin },
        },
        '/ws': {
          target: target.replace(/^http/, 'ws'),
          ws: true,
          changeOrigin: true,
          headers: { origin },
        },
      },
    },
  }
})
