import { defineConfig } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig(({ mode }) => {
  const useHttps = mode === 'lan-https'
  const wsProxyTarget = process.env.VITE_WS_PROXY_TARGET ?? 'http://localhost:8080'

  return {
    plugins: useHttps ? [basicSsl()] : [],
    server: {
      https: useHttps,
      proxy: {
        '/ws': {
          target: wsProxyTarget,
          ws: true,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    preview: {
      https: useHttps,
      proxy: {
        '/ws': {
          target: wsProxyTarget,
          ws: true,
          changeOrigin: true,
          secure: false,
        },
      },
    },
  }
})
