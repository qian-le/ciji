import { Capacitor, CapacitorHttp } from '@capacitor/core'
import type { Mastery, MimoSettings, WordRecord, WordType } from '../types'
import { aiRelayUrl } from '../config'

/** 墨墨开放 API 生产前缀（官方文档 servers.url） */
export const MAIMEMO_OPEN_BASE = 'https://open.maimemo.com/open'

const MAX_RECORDS = 1000
const MAX_HISTORY_PER_WORD = 30
const MAX_WORDS = 3000
const FETCH_TIMEOUT_MS = 20000

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

export type HistItem = { date: string; type: WordType; result: 'remembered' | 'forgot' | 'partial' }

export interface MaimemoDayBucket {
  date: string
  newCount: number
  reviewCount: number
  totalCount: number
  focusCount: number
  score: number
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
  if (s.includes('UNSPECIFIED')) return 'warn'
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

function responseToResult(m: Mastery): HistItem['result'] {
  return m === 'weak' ? 'forgot' : m === 'warn' ? 'partial' : 'remembered'
}

function tagsList(tags?: string | string[]): string[] {
  if (!tags) return []
  return (Array.isArray(tags) ? tags : String(tags).split(/[,;\s]+/)).filter(Boolean).slice(0, 12)
}

function tagsToWeak(tags?: string | string[]): boolean {
  return tagsList(tags).some((t) => t.toUpperCase().includes('STICKING'))
}

/** 墨墨 ISO 时间 → 本地 YYYY-MM-DD */
export function localDateKey(iso?: string): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function withinLastDays(iso: string | undefined, days: number, now: Date): boolean {
  if (!iso) return false
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  const cutoff = new Date(now)
  cutoff.setHours(0, 0, 0, 0)
  cutoff.setDate(cutoff.getDate() - (days - 1))
  return d.getTime() >= cutoff.getTime()
}

function todayKeyLocal(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function normalizeSyncWords(raw: RawSyncWord[], date: string): WordRecord[] {
  return raw
    .map((item, index) => {
      const word = (item.word || '').trim()
      const meaning = item.meaning || item.trans || ''
      const type = normalizeType(item.type ?? item.status ?? item.tag)
      const mastery = normalizeMastery(item.mastery || item.status)
      const frequency = Math.min(item.frequency ?? 1, 9999)
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
    .slice(0, MAX_WORDS)
}

function resolveOpenBase(baseUrl?: string): string {
  const raw = (baseUrl || '').trim()
  if (!raw) return MAIMEMO_OPEN_BASE
  const cleaned = raw.replace(/\/$/, '')
  if (/\/open$/i.test(cleaned)) return cleaned
  if (/open\.maimemo\.com$/i.test(cleaned)) return `${cleaned}/open`
  if (/^https?:\/\//i.test(cleaned)) return cleaned.replace(/\/api\/.*$/i, '')
  return MAIMEMO_OPEN_BASE
}

function parseMaybeJson(text: string): unknown {
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

/**
 * 统一 HTTP：Android/iOS 走 CapacitorHttp（绕过 WebView CORS，避免 fail to fetch），
 * 浏览器开发环境走 fetch + AbortController。
 */
async function requestJson<T>(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown; timeoutMs?: number },
): Promise<{ status: number; data: T }> {
  const method = init.method || 'GET'
  const headers = init.headers || {}
  const timeoutMs = init.timeoutMs ?? FETCH_TIMEOUT_MS

  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.request({
      url,
      method: method as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
      headers,
      data: init.body as never,
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs,
    })
    const raw = res.data
    const data = (typeof raw === 'string' ? parseMaybeJson(raw) : raw) as T
    return { status: res.status, data }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    })
    const text = await res.text()
    return { status: res.status, data: parseMaybeJson(text) as T }
  } finally {
    clearTimeout(timer)
  }
}

async function maimemoFetch<T>(
  baseUrl: string,
  path: string,
  accessToken: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const base = resolveOpenBase(baseUrl)
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`
  const { status, data } = await requestJson<T>(url, {
    method: init?.method || 'GET',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: init?.body,
  })
  if (status < 200 || status >= 300) {
    const obj = data as { errors?: { code?: string; msg?: string }[]; message?: string; success?: boolean }
    const detail =
      obj?.errors?.map((e) => `${e.code || ''}:${e.msg || ''}`).join('; ') ||
      obj?.message ||
      `HTTP ${status}`
    throw new Error(`墨墨 API ${status}: ${detail}`)
  }
  return data
}

export async function fetchMaimemoStudyBundle(params: {
  baseUrl: string
  accessToken: string
  limit?: number
  days?: number
  recordLimit?: number
}): Promise<{
  todayItems: MaimemoStudyTodayItem[]
  progress: MaimemoStudyProgress | null
  records: MaimemoStudyRecord[]
  weekRecords: MaimemoStudyRecord[]
  rawWords: RawSyncWord[]
  dayBuckets: MaimemoDayBucket[]
  historyByWord: Record<string, HistItem[]>
}> {
  if (!params.accessToken) {
    throw new Error('尚未填写墨墨用户 Token，请先在设置中粘贴')
  }
  const days = Math.max(1, Math.min(params.days ?? 7, 30))
  const now = new Date()
  const today = todayKeyLocal(now)

  const todayRes = await maimemoFetch<{ today_items?: MaimemoStudyTodayItem[] }>(
    params.baseUrl,
    '/api/v1/memo/study/get_today_items',
    params.accessToken,
    { method: 'POST', body: { limit: Math.min(params.limit ?? 200, 1000) } },
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

  const todayItems = (todayRes.today_items || []).slice(0, 500)
  const todaySpellings = new Set(
    todayItems.map((t) => (t.voc_spelling || '').toLowerCase()).filter(Boolean),
  )

  let records: MaimemoStudyRecord[] = []
  try {
    const r = await maimemoFetch<{ records?: MaimemoStudyRecord[] }>(
      params.baseUrl,
      '/api/v1/memo/study/query_study_records',
      params.accessToken,
      { method: 'POST', body: { limit: Math.min(params.recordLimit ?? MAX_RECORDS, MAX_RECORDS) } },
    )
    records = (r.records || []).slice(0, MAX_RECORDS)
  } catch {
    records = []
  }

  if (todaySpellings.size) {
    try {
      const spellings = Array.from(todaySpellings).slice(0, 200)
      const r2 = await maimemoFetch<{ records?: MaimemoStudyRecord[] }>(
        params.baseUrl,
        '/api/v1/memo/study/query_study_records',
        params.accessToken,
        { method: 'POST', body: { spellings, limit: 200 } },
      )
      const seen = new Set(records.map((x) => x.voc_id || x.voc_spelling))
      for (const e of r2.records || []) {
        const k = e.voc_id || e.voc_spelling
        if (!seen.has(k)) {
          records.push(e)
          seen.add(k)
        }
      }
    } catch {
      /* ignore */
    }
  }

  const weekRecords = records.filter(
    (r) =>
      withinLastDays(r.last_study_date, days, now) ||
      withinLastDays(r.first_study_date, days, now) ||
      todaySpellings.has((r.voc_spelling || '').toLowerCase()),
  )

  const recMap = new Map<string, MaimemoStudyRecord>()
  for (const r of records) {
    if (!r.voc_spelling) continue
    recMap.set(r.voc_spelling.toLowerCase(), r)
  }

  const historyByWord: Record<string, HistItem[]> = {}
  const dayStatsMap = new Map<string, { newSet: Set<string>; reviewSet: Set<string>; weakSet: Set<string> }>()

  function ensureDay(date: string) {
    if (!dayStatsMap.has(date)) dayStatsMap.set(date, { newSet: new Set(), reviewSet: new Set(), weakSet: new Set() })
    return dayStatsMap.get(date)!
  }

  function pushHist(word: string, date: string | null, type: WordType, result: HistItem['result']) {
    if (!date || !word) return
    const key = word.toLowerCase()
    if (!historyByWord[key]) historyByWord[key] = []
    const hist = historyByWord[key]
    if (hist.length >= MAX_HISTORY_PER_WORD) return
    if (hist.some((h) => h.date === date && h.type === type)) return
    hist.push({ date, type, result })
    const bucket = ensureDay(date)
    if (type === 'new') bucket.newSet.add(key)
    else bucket.reviewSet.add(key)
    if (result !== 'remembered') bucket.weakSet.add(key)
  }

  for (const rec of weekRecords) {
    const word = rec.voc_spelling
    if (!word) continue
    const mastery = responseToMastery(rec.last_response)
    const last = localDateKey(rec.last_study_date)
    const first = localDateKey(rec.first_study_date)
    if (last) pushHist(word, last, 'review', responseToResult(mastery))
    if (first && first !== last) pushHist(word, first, 'new', 'partial')
  }

  for (const item of todayItems) {
    const word = item.voc_spelling
    if (!word) continue
    const rec = recMap.get(word.toLowerCase())
    const resp = item.first_response
    const hasResp = Boolean(resp) && !String(typeof resp === 'string' ? resp : resp?.response || '').includes('UNSPECIFIED')
    const mastery = hasResp
      ? responseToMastery(resp)
      : rec?.last_response
        ? responseToMastery(rec.last_response)
        : item.is_finished
          ? 'good'
          : 'warn'
    pushHist(word, today, item.is_new ? 'new' : 'review', responseToResult(mastery))
  }

  const rawWordMap = new Map<string, RawSyncWord>()

  function upsertRaw(word: string, patch: Partial<RawSyncWord>) {
    if (!word || rawWordMap.size >= MAX_WORDS) return
    const key = word.toLowerCase()
    const prev = rawWordMap.get(key) || { word }
    rawWordMap.set(key, { ...prev, ...patch, word })
  }

  for (const rec of weekRecords) {
    const word = rec.voc_spelling
    if (!word) continue
    const tags = tagsList(rec.tags)
    const mastery = responseToMastery(rec.last_response)
    const weak = tagsToWeak(rec.tags) || mastery === 'weak'
    const hist = historyByWord[word.toLowerCase()] || []
    upsertRaw(word, {
      type: 'review',
      mastery,
      frequency: Math.min(rec.study_count ?? hist.length ?? 1, 9999),
      weak,
      focus: weak || (rec.study_count ?? 0) >= 3,
      tag: tags.join(','),
      studyCount: rec.study_count,
    })
  }

  for (const item of todayItems) {
    const word = item.voc_spelling
    if (!word) continue
    const rec = recMap.get(word.toLowerCase())
    const tags = tagsList(rec?.tags)
    const resp = item.first_response
    const hasResp = Boolean(resp) && !String(typeof resp === 'string' ? resp : resp?.response || '').includes('UNSPECIFIED')
    const mastery = hasResp
      ? responseToMastery(resp)
      : rec?.last_response
        ? responseToMastery(rec.last_response)
        : item.is_finished
          ? 'good'
          : 'warn'
    const weak = item.is_finished === false || tagsToWeak(rec?.tags) || mastery === 'weak'
    const hist = historyByWord[word.toLowerCase()] || []
    upsertRaw(word, {
      type: item.is_new ? 'new' : 'review',
      mastery,
      frequency: Math.min(Math.max(rec?.study_count ?? 0, hist.length, 1), 9999),
      weak,
      focus: weak || item.is_new === false,
      status: item.is_finished ? 'finished' : 'unfinished',
      tag: tags.join(','),
      finished: item.is_finished,
      studyCount: rec?.study_count,
    })
  }

  const dayBuckets: MaimemoDayBucket[] = Array.from(dayStatsMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-31)
    .map(([date, b]) => {
      const totalCount = b.newSet.size + b.reviewSet.size
      const weak = b.weakSet.size
      return {
        date,
        newCount: b.newSet.size,
        reviewCount: b.reviewSet.size,
        totalCount,
        focusCount: weak,
        score: totalCount ? Math.min(100, Math.round(((totalCount - weak) / totalCount) * 70 + 30)) : 0,
      }
    })

  return {
    todayItems,
    progress,
    records,
    weekRecords,
    rawWords: Array.from(rawWordMap.values()),
    dayBuckets,
    historyByWord,
  }
}

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
    '学习单词为空。请确认 Token 有效；近一周是否在墨墨中有学习记录；App 已开启自动同步。公测接口可能随时调整。',
  )
}

export function parseImportPayload(text: string): RawSyncWord[] {
  const trimmed = text.trim()
  if (!trimmed) throw Error('请粘贴 JSON 数据')
  if (trimmed.length > 2_000_000) throw Error('导入数据过大')
  const json = JSON.parse(trimmed) as unknown
  if (!Array.isArray(json) && typeof json === 'object' && json) {
    const obj = json as Record<string, unknown>
    const keys = ['words', 'items', 'list', 'data', 'records', 'vocabulary', 'today_items']
    for (const key of keys) {
      const value = obj[key]
      if (Array.isArray(value)) {
        return (value as unknown[]).slice(0, MAX_WORDS).map((row) => {
          if (typeof row === 'string') return { word: row, type: 'new' as const, mastery: 'warn' as const }
          const r = row as Record<string, unknown>
          return {
            word: String(r.word || r.voc_spelling || r.spelling || ''),
            meaning: String(r.meaning || r.trans || r.translation || ''),
            type: (r.type || r.status || (r.is_new ? 'new' : 'review')) as string,
            mastery: (r.mastery || r.level) as string | undefined,
            frequency:
              typeof r.frequency === 'number'
                ? r.frequency
                : typeof r.study_count === 'number'
                  ? r.study_count
                  : undefined,
          }
        })
      }
    }
  }
  if (Array.isArray(json)) {
    return json.slice(0, MAX_WORDS).map((row) => {
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
  const relay = aiRelayUrl()
  if (!relay && !settings.apiKey) {
    throw new Error(
      'MiMo 未就绪：请在设置中于本机保存 API Key，或配置 Worker 中继。（Key 不会出现在公网前端/APK）',
    )
  }
  const base = settings.baseUrl.replace(/\/$/, '')
  const url = relay || `${base}/chat/completions`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (relay) {
    headers['X-Ciji-Client'] = 'web'
  } else {
    headers.Authorization = `Bearer ${settings.apiKey}`
  }

  const payload = {
    model: settings.model || 'mimo-v2.5',
    messages: messages.slice(-20),
    temperature: 0.7,
  }

  const { status, data } = await requestJson<{
    choices?: { message?: { content?: string } }[]
    error?: { message?: string }
  }>(url, { method: 'POST', headers, body: payload, timeoutMs: 60000 })

  if (status < 200 || status >= 300) {
    const detail = data?.error?.message || `HTTP ${status}`
    throw new Error(`MiMo 请求失败: ${detail}`)
  }
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error('MiMo 返回内容为空')
  return String(content)
}

export async function testMimoConnection(settings: MimoSettings): Promise<{ ok: boolean; message: string }> {
  if (!settings.apiKey && !aiRelayUrl()) return { ok: false, message: '尚未填写 API Key' }
  try {
    const content = await chatComplete(settings, [{ role: 'user', content: 'ping，回复 pong 即可' }])
    return { ok: true, message: `连接成功：${content.slice(0, 40)}` }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '连接失败' }
  }
}

export async function testMaimemoToken(params: {
  baseUrl: string
  accessToken: string
  days?: number
}): Promise<{
  ok: boolean
  message: string
  todayCount?: number
  weekCount?: number
  progress?: MaimemoStudyProgress | null
}> {
  if (!params.accessToken) return { ok: false, message: '请先粘贴用户 Token' }
  try {
    const bundle = await fetchMaimemoStudyBundle({ ...params, days: params.days ?? 7 })
    const p = bundle.progress
    return {
      ok: true,
      message: `连接成功。今日 ${bundle.todayItems.length} 词，近一周学习词 ${bundle.weekRecords.length}，进度 ${p?.finished ?? 0}/${p?.total ?? '—'}`,
      todayCount: bundle.todayItems.length,
      weekCount: bundle.weekRecords.length,
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
