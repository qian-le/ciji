/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_MAIMEMO_CLIENT_ID?: string
  readonly VITE_MAIMEMO_ISSUER?: string
  readonly VITE_MAIMEMO_SCOPE?: string
  readonly VITE_MAIMEMO_REDIRECT_URI?: string
  readonly VITE_AI_RELAY_URL?: string
  /** 构建时可选注入；勿提交到 git。公开 Pages 上会出现在前端包中 */
  readonly VITE_MIMO_API_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
