import type { Mastery, MimoSettings, WordRecord, WordType } from '../types'
import { aiRelayUrl } from '../config'

export interface RawSyncWord {
  word: string
  phonetic?: string
  meaning?: string
  trans?: string
  type?: WordType | string
  mastery?: Mastery | string
  frequency?: number
  status?: string
  tag?: string
}

function normalizeMastery(input?: string): Mastery {
  const s = (input || '').toLowerCase()
  if (s.includes('weak') || s.includes('bad') || s.includes('差') || s.includes('忘')) return 'weak'
  if (s.includes('warn') || s.includes('mid') || s.includes('一般')) return 'warn'
  return 'good'
}

function normalizeType(input?: string): WordType {
  const s = (input || '').toLowerCase()
  if (s.includes('new') || s.includes('新')) return 'new'
  return 'review'
}

export function normalizeSyncWords(raw: RawSyncWord[], date: string): WordRecord[] {
  return raw
    .map((item, index) => {
      const word = (item.word || '').trim()
      const meaning = item.meaning || item.trans || ''
      const type = normalizeType(item.type || item.status || item.tag)
      const mastery = normalizeMastery(item.mastery || item.status)
      const frequency = item.frequency ?? 1
      const weak = mastery === 'weak' || /weak|薄弱|强化/.test(item.status || item.tag || '')
      return {
        id: `sync-${date}-${word.toLowerCase()}-${index}`,
        word,
        phonetic: item.phonetic,
        meaning,
        type,
        mastery,
        frequency,
        weak,
        focus: weak || frequency >= 3,
        history: [{ date, type, result: weak ? ('partial' as const) : ('remembered' as const) }],
      }
    })
    .filter((w) => w.word)
}

export async function fetchMaimemoWords(params: {
  baseUrl: string
  accessToken: string
  accountId?: string
}): Promise<RawSyncWord[]> {
  if (!params.accessToken) throw new Error('尚未连接墨墨账号，请先登录')
  const base = params.baseUrl.replace(/\/$/, '')
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${params.accessToken}`,
  }

  const candidates = [
    `${base}/api/v1/user/vocabulary/today`,
    `${base}/api/v1/vocabulary/today`,
    `${base}/api/v1/open/learning/today`,
  ]

  let lastError = '同步失败'
  for (const url of candidates) {
    try {
      const target = new URL(url)
      if (params.accountId) target.searchParams.set('accountId', params.accountId)
      const res = await fetch(target.toString(), { headers })
      if (res.status >= 200 && res.status < 300) {
        const data = (await res.json()) as unknown
        const list = extractWordList(data)
        if (list.length) return list
        lastError = '接口返回为空，请检查开放平台权限或数据字段'
      } else {
        lastError = `HTTP ${res.status}`
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
    }
  }
  throw new Error(lastError)
}

function extractWordList(data: unknown): RawSyncWord[] {
  if (!data) return []
  if (Array.isArray(data)) return data as RawSyncWord[]
  const obj = data as Record<string, unknown>
  const keys = ['words', 'items', 'list', 'data', 'records', 'vocabulary']
  for (const key of keys) {
    const value = obj[key]
    if (Array.isArray(value)) return value as RawSyncWord[]
    if (value && typeof value === 'object') {
      const nested = value as Record<string, unknown>
      for (const k of keys) {
        if (Array.isArray(nested[k])) return nested[k] as RawSyncWord[]
      }
    }
  }
  return []
}

export function parseImportPayload(text: string): RawSyncWord[] {
  const trimmed = text.trim()
  if (!trimmed) throw Error('请粘贴 JSON 数据')
  const json = JSON.parse(trimmed) as unknown
  const list = extractWordList(json)
  if (!list.length) {
    if (Array.isArray(json) && json.every((x) => typeof x === 'string')) {
      return (json as string[]).map((w) => ({ word: w, type: 'new', mastery: 'warn' }))
    }
    throw Error('未识别到单词列表，支持 JSON 数组或 {words:[...]}')
  }
  return list
}

export async function chatComplete(settings: MimoSettings, messages: { role: string; content: string }[]): Promise<string> {
  if (!settings.apiKey) {
    throw new Error('请先在设置中填写 MiMo API Key（仅保存在本机）')
  }
  const relay = aiRelayUrl()
  const base = settings.baseUrl.replace(/\/$/, '')
  const url = relay || `${base}/chat/completions`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (!relay) {
    headers.Authorization = `Bearer ${settings.apiKey}`
  } else {
    // Worker 中继：Key 不经过前端源码，由 Worker Secret 注入
    headers['X-Ciji-Client'] = 'web'
  }

  const payload = relay
    ? { model: settings.model || 'mimo-v2.5', messages, temperature: 0.7 }
    : { model: settings.model || 'mimo-v2.5', messages, temperature: 0.7 }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`MiMo 请求失败 HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  const data = JSON.parse(text) as {
    choices?: { message?: { content?: string } }[]
  }
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error('MiMo 返回内容为空')
  return String(content)
}

export async function testMimoConnection(settings: MimoSettings): Promise<{ ok: boolean; message: string }> {
  if (!settings.apiKey) return { ok: false, message: '尚未填写 API Key' }
  try {
    const content = await chatComplete(settings, [
      { role: 'user', content: 'ping，回复 pong 即可' },
    ])
    return { ok: true, message: `连接成功：${content.slice(0, 40)}` }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '连接失败' }
  }
}

export function extractJson<T>(text: string): T {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)
  const raw = fenced ? fenced[1] : text
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  const arrayStart = raw.indexOf('[')
  const arrayEnd = raw.lastIndexOf(']')
  if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1)) as T
  if (arrayStart >= 0 && arrayEnd > arrayStart) return JSON.parse(raw.slice(arrayStart, arrayEnd + 1)) as T
  throw new Error('AI 返回的不是合法 JSON')
}

export function isOnline(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true
}

export function offlineError(): Error {
  return new Error('当前无网络连接。')
}
