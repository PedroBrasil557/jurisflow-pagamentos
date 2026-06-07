import tailwindcss from '@tailwindcss/vite'
import { devtools } from '@tanstack/devtools-vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'

const config = defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const port = Number(env.PORT ?? 3555)
  const apiProxyTarget = env.API_PROXY_TARGET ?? 'http://localhost:3556'
  // No Docker em Windows/WSL o inotify nao detecta alteracoes no bind mount;
  // ligamos o polling via env para o HMR funcionar sem reiniciar o container.
  const usePolling = env.VITE_USE_POLLING === 'true'

  return {
    server: {
      fs: {
        allow: ['..'],
      },
      host: '0.0.0.0',
      port,
      strictPort: true,
      watch: usePolling
        ? {
            usePolling: true,
            interval: 300,
          }
        : undefined,
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
    plugins: [
      devtools(),
      tsconfigPaths({ projects: ['./tsconfig.json'] }),
      tailwindcss(),
      TanStackRouterVite(),
      viteReact(),
    ],
  }
})

export default config
