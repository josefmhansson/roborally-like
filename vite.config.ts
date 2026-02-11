import { defineConfig } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig(({ mode }) => {
  const useHttps = mode === 'lan-https'

  return {
    plugins: useHttps ? [basicSsl()] : [],
    server: {
      https: useHttps,
    },
    preview: {
      https: useHttps,
    },
  }
})
