import type { CapacitorConfig } from '@capacitor/cli'

// URL hospedada do JurisFlow carregada dentro do WebView nativo.
// Defina CAPACITOR_SERVER_URL no ambiente de build (ex.: https://app.seudominio.com).
const serverUrl = process.env.CAPACITOR_SERVER_URL

const config: CapacitorConfig = {
  appId: 'com.jurisflow.app',
  appName: 'JurisFlow',
  webDir: 'dist',
  ...(serverUrl
    ? {
        server: {
          url: serverUrl,
          cleartext: false,
        },
      }
    : {}),
}

export default config
