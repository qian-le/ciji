/**
 * 词迹前端配置。
 * 只允许出现可公开的 client_id / issuer / scope / redirect_uri。
 * 禁止在此文件写入 MiMo API Key 或墨墨 client_secret。
 */

function readEnv(key: string): string {
  const v = (import.meta.env[key] as string | undefined) ?? ''
  return v.trim()
}

/** 自动推导 GitHub Pages 子路径下的 OAuth 回调 */
export function resolveRedirectUri(): string {
  const configured = readEnv('VITE_MAIMEMO_REDIRECT_URI')
  if (configured) return configured
  const origin = window.location.origin
  const path = window.location.pathname.replace(/index\.html$/i, '')
  const base = path.endsWith('/') ? path.slice(0, -1) : path
  return `${origin}${base}/auth/callback`
}

/** 应用静态资源 base（与 Vite base 一致，兼容 GH Pages 子路径） */
export function appBasePath(): string {
  const path = window.location.pathname.replace(/index\.html$/i, '')
  return path.endsWith('/') ? path : `${path}/`
}

export function maimemoConfig() {
  return {
    issuer: readEnv('VITE_MAIMEMO_ISSUER') || 'https://accounts.maimemo.com/oidc',
    clientId: readEnv('VITE_MAIMEMO_CLIENT_ID'),
    scope: readEnv('VITE_MAIMEMO_SCOPE') || 'openid profile',
    redirectUri: resolveRedirectUri(),
  }
}

export function mimoDefaults() {
  return {
    baseUrl: 'https://api.xiaomimimo.com/v1',
    model: 'mimo-v2.5',
    apiKey: readEnv('VITE_MIMO_API_KEY'),
  }
}

export function aiRelayUrl(): string {
  return readEnv('VITE_AI_RELAY_URL')
}

export const APP_NAME = '词迹'
