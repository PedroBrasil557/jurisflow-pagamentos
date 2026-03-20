import tailwindcss from '@tailwindcss/vite'
import { devtools } from '@tanstack/devtools-vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'

const port = Number(process.env.PORT ?? 3555)

const config = defineConfig({
  server: {
    fs: {
      allow: ['..'],
    },
    host: '0.0.0.0',
    port,
    strictPort: true,
  },
  plugins: [
    devtools(),
    tsconfigPaths({ projects: ['./tsconfig.json'] }),
    tailwindcss(),
    TanStackRouterVite(),
    viteReact(),
  ],
})

export default config
