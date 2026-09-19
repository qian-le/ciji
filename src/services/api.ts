import type { Mastery, MimoSettings, WordRecord, WordType } from '../types'
import { aiRelayUrl } from '../config'

/** 墨墨开放 API 生产前缀（官方文档 servers.url） */
export const MAIMEMO_OPEN_BASE = 'https://open.maimemo.com/open'

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
  weak?: boolean
  focus?: boolean
  finished?: boolean
  studyCount?: number
}

interface MaimemoStudyTodayItem {
  voc_id: string
  voc_spelling: string
  order?: number
  is_new?: boolean
  is_finished?: boolean
  first_response?: string | { response?: string; value?: string }
}

interface MaimemoStudyRecord {
  voc_id: string
  voc_spelling: string
  add_date?: string
  first_study_date?: string
  last_study_date?: string
  next_study_date?: string
  last_response?: string
  study_count?: number
  tags?: string | string[]
}

interface MaimemoStudyProgress {
  finished?: number
  total?: number
  study_time?: number
}

function normalizeMastery(input?: string): Mastery {
  const s = (input || '').toUpperCase()
  if (s === 'FORGET' || s.includes('FORGET') || s === 'BAD' || s.includes('WRONG')) return 'weak'
  if (s === 'VAGUE' || s === 'CANCEL_WELL_FAMILIAR' || s.includes('PARTIAL') || s.includes('HARD')) return 'warn'
  if (s === 'FAMILIAR' || s === 'WELL_FAMILIAR' || s.includes('REMEMBER') || s === 'GOOD' || s.includes('KNOW')) return 'good'
  return 'warn'
}

function normalizeType(input?: string | boolean): WordType {
  if (input === true) return 'new'
  const s = String(input || '').toLowerCase()
  if (s === 'true' || s.includes('new') || s.includes('新')) return 'new'
  return 'review'
}

function responseToMastery(resp?: string | { response?: string; value?: string }): Mastery {
  if (!resp) return 'warn'
  const raw = typeof resp === 'string' ? resp : resp.response || resp.value || ''
  return normalizeMastery(raw)
}

function tagsToWeak(tags?: string | string[]): boolean {
  if (!tags) return false
  const list = Array.isArray(tags) ? tags : String(tags).split(/[,;\s]+/)
  return list.some((t) => String(t).toUpperCase().includes('STICKING'))
}

export function normalizeSyncWords(raw: RawSyncWord[], date: string): WordRecord[] {
  return raw
    .map((item, index) => {
      const word = (item.word || '').trim()
      const meaning = item.meaning || item.trans || ''
      const type = normalizeType(item.type ?? item.status ?? item.tag)
      const mastery = normalizeMastery(item.mastery || item.status)
      const frequency = item.frequency ?? 1
      const weak = item.weak === true || mastery === 'weak' || /weak|薄弱|强化|STICKING/i.test(item.status || item.tag || '')
      return {
        id: `sync-${date}-${word.toLowerCase()}-${index}`,
        word,
        phonetic: item.phonetic,
        meaning,
        type,
        mastery,
        frequency,
        weak,
        focus: item.focus === true || weak || frequency >= 3,
        history: [{ date, type, result: weak ? ('partial' as const) : ('remembered' as const) }],
      }
    })
    .filter((w) => w.word)
}

function resolveOpenBase(baseUrl?: string): string {
  const raw = (baseUrl || '').trim()
  if (!raw) return MAIMEMO_OPEN_BASE
  const cleaned = raw.replace(/\/$/, '')
  // 允许用户直接填完整 open 前缀，或只填域名
  if (/\/open$/i.test(cleaned)) return cleaned
  if (/open\.maimemo\.com$/i.test(cleaned)) return `${cleaned}/open`
  if (/^https?:\/\//i.test(cleaned)) {
    // 若填了 open.maimemo.com/open/api/... 则退回 /open
    return cleaned.replace(/\/api\/.*$/i, '')
  }
  return MAIMEMO_OPEN_BASE
}

async function maimemoFetch<T>(
  baseUrl: string,
  path: string,
  accessToken: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const base = resolveOpenBase(baseUrl)
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`
  const res = await fetch(url, {
    method: init?.method || 'GET',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const text = await res.text()
  if (!res.ok) {
    let detail = text.slice(0, 200)
    try {
      const j = JSON.parse(text) as { message?: string; error?: string; msg?: string }
      detail = j.message || j.error || j.msg || detail
    } catch {
      /* keep text */
    }
    throw new Error(`墨墨 API ${res.status}: ${detail}`)
  }
  return (text ? JSON.parse(text) : {}) as T
}

/**
 * 按官方文档同步今日学习数据。
 * 文档：https://open.maimemo.com/document#/
 * - POST /api/v1/memo/study/get_today_items
 * - POST /api/v1/memo/study/get_study_progress
 * - POST /api/v1/memo/study/query_study_records
 * - POST /api/v1/memo/vocabulary/query （可选补全）
 * Base：https://open.maimemo.com/open
 * Auth：Authorization: Bearer <用户 Token>
 */
export async function fetchMaimemoStudyBundle(params: {
  baseUrl: string
  accessToken: string
  limit?: number
}): Promise<{
  todayItems: MaimemoStudyTodayItem[]
  progress: MaimemoStudyProgress | null
  records: MaimemoStudyRecord[]
  rawWords: RawSyncWord[]
}> {
  if (!params.accessToken) {
    throw new Error('尚未填写墨墨用户 Token，请先在设置中粘贴')
  }

  // 公测接口：需要 App 开启自动同步；当日未打开 App 可能为空
  const todayRes = await maimemoFetch<{ today_items?: MaimemoStudyTodayItem[] }>(
    params.baseUrl,
    '/api/v1/memo/study/get_today_items',
    params.accessToken,
    { method: 'POST', body: { limit: params.limit ?? 200 } },
  )

  let progress: MaimemoStudyProgress | null = null
  try {
    const p = await maimemoFetch<{ progress?: MaimemoStudyProgress }>(
      params.baseUrl,
      '/api/v1/memo/study/get_study_progress',
      params.accessToken,
      { method: 'POST', body: {} },
    )
    progress = p.progress || null
  } catch {
    progress = null
  }

  const todayItems = todayRes.today_items || []
  const spellings = todayItems.map((t) => t.voc_spelling).filter(Boolean)

  let records: MaimemoStudyRecord[] = []
  if (spellings.length) {
    try {
      const r = await maimemoFetch<{ records?: MaimemoStudyRecord[] }>(
        params.baseUrl,
        '/api/v1/memo/study/query_study_records',
        params.accessToken,
        { method: 'POST', body: { spellings: spellings.slice(0, 200), limit: 200 } },
      )
      records = r.records || []
    } catch {
      records = []
    }
  }

  const recMap = new Map(records.map((r) => [r.voc_spelling?.toLowerCase(), r]))

  const rawWords: RawSyncWord[] = todayItems.map((item) => {
    const rec = recMap.get(item.voc_spelling?.toLowerCase())
    const mastery = item.first_response
      ? responseToMastery(item.first_response)
      : rec?.last_response
        ? responseToMastery(rec.last_response)
        : item.is_finished
          ? 'good'
          : 'warn'
    const tags = rec?.tags
    const weak = item.is_finished === false || tagsToWeak(tags) || mastery === 'weak'
    return {
      word: item.voc_spelling,
      type: item.is_new ? 'new' : 'review',
      mastery,
      frequency: rec?.study_count ?? 1,
      weak,
      focus: weak || item.is_new === false,
      status: item.is_finished ? 'finished' : 'unfinished',
      tag: Array.isArray(tags) ? tags.join(',') : tags,
      finished: item.is_finished,
      studyCount: rec?.study_count,
    }
  })

  return { todayItems, progress, records, rawWords }
}

/** 兼容旧调用：拉取今日单词 */
export async function fetchMaimemoWords(params: {
  baseUrl: string
  accessToken: string
  accountId?: string
}): Promise<RawSyncWord[]> {
  const bundle = await fetchMaimemoStudyBundle({
    baseUrl: params.baseUrl,
    accessToken: params.accessToken,
  })
  if (bundle.rawWords.length) return bundle.rawWords
  throw new Error(
    '今日学习单词为空。请确认：1) Token 来自墨墨 App「开放 API」或 open.maimemo.com；2) 今日已打开墨墨背单词并完成初始化；3) App 已开启自动同步。公测接口可能随时调整。',
  )
}

export function parseImportPayload(text: string): RawSyncWord[] {
  const trimmed = text.trim()
  if (!trimmed) throw Error('请粘贴 JSON 数据')
  const json = JSON.parse(trimmed) as unknown
  if (!Array.isArray(json) && typeof json === 'object' && json) {
    const obj = json as Record<string, unknown>
    const keys = ['words', 'items', 'list', 'data', 'records', 'vocabulary', 'today_items']
    for (const key of keys) {
      const value = obj[key]
      if (Array.isArray(value)) {
        return (value as unknown[]).map((row) => {
          if (typeof row === 'string') return { word: row, type: 'new' as const, mastery: 'warn' as const }
          const r = row as Record<string, unknown>
          return {
            word: String(r.word || r.voc_spelling || r.spelling || ''),
            meaning: String(r.meaning || r.trans || r.translation || ''),
            type: (r.type || r.status || (r.is_new ? 'new' : 'review')) as string,
            mastery: (r.mastery || r.level) as string | undefined,
            frequency: typeof r.frequency === 'number' ? r.frequency : typeof r.study_count === 'number' ? r.study_count : undefined,
          }
        })
      }
    }
  }
  if (Array.isArray(json)) {
    return json.map((row) => {
      if (typeof row === 'string') return { word: row, type: 'new' as const, mastery: 'warn' as const }
      const r = row as Record<string, unknown>
      return {
        word: String(r.word || r.voc_spelling || r.spelling || ''),
        meaning: String(r.meaning || r.trans || ''),
        type: (r.type || r.status || (r.is_new ? 'new' : 'review')) as string,
        mastery: r.mastery as string | undefined,
      }
    })
  }
  throw Error('未识别到单词列表，支持 JSON 数组、{words:[...]} 或墨墨 today_items 结构')
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
    headers['X-Ciji-Client'] = 'web'
  }

  const payload = {
    model: settings.model || 'mimo-v2.5',
    messages,
    temperature: 0.7,
  }

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
    const content = await chatComplete(settings, [{ role: 'user', content: 'ping，回复 pong 即可' }])
    return { ok: true, message: `连接成功：${content.slice(0, 40)}` }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '连接失败' }
  }
}

export async function testMaimemoToken(params: { baseUrl: string; accessToken: string }): Promise<{
  ok: boolean
  message: string
  todayCount?: number
  progress?: MaimemoStudyProgress | null
}> {
  if (!params.accessToken) return { ok: false, message: '请先粘贴用户 Token' }
  try {
    const bundle = await fetchMaimemoStudyBundle(params)
    const p = bundle.progress
    return {
      ok: true,
      message: p
        ? `连接成功。今日进度 ${p.finished ?? 0}/${p.total ?? 0}，学习词 ${bundle.todayItems.length} 个`
        : `连接成功。今日学习词 ${bundle.todayItems.length} 个`,
      todayCount: bundle.todayItems.length,
      progress: p,
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Token 测试失败' }
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
