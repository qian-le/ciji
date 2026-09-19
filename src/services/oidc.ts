import { maimemoConfig } from '../config'

const VERIFIER_KEY = 'ciji.maimemo.pkce.verifier'
const STATE_KEY = 'ciji.maimemo.pkce.state'
const NONCE_KEY = 'ciji.maimemo.pkce.nonce'

export interface OidcEndpoints {
  authorization_endpoint: string
  token_endpoint: string
  userinfo_endpoint?: string
  end_session_endpoint?: string
}

function base64UrlEncode(bytes: Uint8Array): string {
  let str = ''
  bytes.forEach((b) => {
    str += String.fromCharCode(b)
  })
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256(plain: string): Promise<string> {
  const data = new TextEncoder().encode(plain)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return base64UrlEncode(new Uint8Array(digest))
}

export function randomString(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes)
}

export async function discoverOidcEndpoints(issuer: string): Promise<OidcEndpoints> {
  const base = issuer.replace(/\/$/, '')
  const url = `${base}/.well-known/openid-configuration`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    // 常见回退：issuer + /authorize、/token
    return {
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      userinfo_endpoint: `${base}/userinfo`,
    }
  }
  const json = (await res.json()) as Partial<OidcEndpoints>
  if (!json.authorization_endpoint || !json.token_endpoint) {
    throw new Error('OIDC discovery 缺少 authorization/token 端点')
  }
  return {
    authorization_endpoint: json.authorization_endpoint,
    token_endpoint: json.token_endpoint,
    userinfo_endpoint: json.userinfo_endpoint,
    end_session_endpoint: json.end_session_endpoint,
  }
}

export async function beginMaimemoLogin(): Promise<void> {
  const cfg = maimemoConfig()
  if (!cfg.clientId) {
    throw new Error('尚未配置 MAIMEMO_CLIENT_ID（见 .env 或部署变量）')
  }
  const endpoints = await discoverOidcEndpoints(cfg.issuer)
  const verifier = randomString(32)
  const state = randomString(16)
  const nonce = randomString(16)
  const challenge = await sha256(verifier)
  sessionStorage.setItem(VERIFIER_KEY, verifier)
  sessionStorage.setItem(STATE_KEY, state)
  sessionStorage.setItem(NONCE_KEY, nonce)

  const authUrl = new URL(endpoints.authorization_endpoint)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', cfg.clientId)
  authUrl.searchParams.set('redirect_uri', cfg.redirectUri)
  authUrl.searchParams.set('scope', cfg.scope)
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('nonce', nonce)
  authUrl.searchParams.set('code_challenge', challenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')
  // 部分 OIDC 需要 audience / resource，可按开放平台文档追加
  window.location.assign(authUrl.toString())
}

export interface TokenResult {
  access_token: string
  refresh_token?: string
  id_token?: string
  token_type?: string
  expires_in?: number
  scope?: string
}

export async function completeMaimemoCallback(search: string): Promise<{
  tokens: TokenResult
  user: { sub?: string; name?: string; preferred_username?: string; email?: string } | null
}> {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const error = params.get('error')
  if (error) {
    const desc = params.get('error_description') || error
    throw new Error(`墨墨授权失败：${desc}`)
  }
  const code = params.get('code')
  const state = params.get('state')
  const expectedState = sessionStorage.getItem(STATE_KEY)
  const verifier = sessionStorage.getItem(VERIFIER_KEY)
  if (!code) throw new Error('授权回调缺少 code')
  if (!expectedState || state !== expectedState) throw new Error('授权 state 校验失败')
  if (!verifier) throw new Error('PKCE verifier 丢失，请重新登录')

  const cfg = maimemoConfig()
  const endpoints = await discoverOidcEndpoints(cfg.issuer)

  const body = new URLSearchParams()
  body.set('grant_type', 'authorization_code')
  body.set('code', code)
  body.set('redirect_uri', cfg.redirectUri)
  body.set('client_id', cfg.clientId)
  body.set('code_verifier', verifier)

  const res = await fetch(endpoints.token_endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  })
  const text = await res.text()
  let json: TokenResult & { error?: string; error_description?: string }
  try {
    json = JSON.parse(text) as TokenResult & { error?: string; error_description?: string }
  } catch {
    throw new Error(`Token 端点返回无法解析：${text.slice(0, 180)}`)
  }
  if (!res.ok || json.error || !json.access_token) {
    throw new Error(json.error_description || json.error || `Token 交换失败 HTTP ${res.status}`)
  }

  sessionStorage.removeItem(VERIFIER_KEY)
  sessionStorage.removeItem(STATE_KEY)
  sessionStorage.removeItem(NONCE_KEY)

  let user: { sub?: string; name?: string; preferred_username?: string; email?: string } | null = null
  if (endpoints.userinfo_endpoint) {
    try {
      const ures = await fetch(endpoints.userinfo_endpoint, {
        headers: { Authorization: `Bearer ${json.access_token}` },
      })
      if (ures.ok) user = (await ures.json()) as typeof user
    } catch {
      user = null
    }
  }
  if (!user && json.id_token) {
    try {
      const payload = json.id_token.split('.')[1]
      const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as typeof user
      user = decoded
    } catch {
      user = null
    }
  }

  return { tokens: json, user }
}

export function isOAuthCallbackHash(hash: string): boolean {
  return hash.startsWith('#/auth/callback')
}

export function extractSearchFromCallbackHash(hash: string): string {
  const idx = hash.indexOf('?')
  return idx >= 0 ? hash.slice(idx) : ''
}
