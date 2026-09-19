/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_MAIMEMO_CLIENT_ID?: string
  readonly VITE_MAIMEMO_ISSUER?: string
  readonly VITE_MAIMEMO_SCOPE?: string
  readonly VITE_MAIMEMO_REDIRECT_URI?: string
  readonly VITE_AI_RELAY_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
