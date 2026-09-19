import Dexie, { type EntityTable } from 'dexie'
import type {
  AiHomeSummary,
  AppData,
  AppSettings,
  QuizRecord,
  ReviewBundle,
  StoryRecord,
  WordLearningRecord,
  WordRecord,
} from './types'
import { defaultSettings, isLikelySampleWordId } from './seed-app'
import { buildSeedDayStats, buildSeedWords } from './seed'
import { buildLocalHomeSummary, buildLocalReview, todayKey } from './analyzer'
import { mimoDefaults } from './config'

export interface DbWordRow extends WordRecord {
  updatedAt: string
}

export interface DailyLearningRow {
  id: string
  date: string
  wordId: string
  word: string
  type: 'new' | 'review'
  mastery: WordRecord['mastery']
}

export interface DailySnapshotRow {
  id: string
  date: string
  newCount: number
  reviewCount: number
  totalCount: number
  focusCount: number
  score: number
}

export interface AiPackageRow {
  id: string
  date: string
  kind: 'story' | 'review' | 'home'
  payload: StoryRecord | ReviewBundle | AiHomeSummary
  createdAt: string
}

export interface SettingsRow {
  key: string
  value: unknown
}

export class CijiDB extends Dexie {
  words!: EntityTable<DbWordRow, 'id'>
  wordLearningRecords!: EntityTable<WordLearningRecord, 'id'>
  dailyLearning!: EntityTable<DailyLearningRow, 'id'>
  dailySnapshots!: EntityTable<DailySnapshotRow, 'id'>
  aiDailyPackages!: EntityTable<AiPackageRow, 'id'>
  quizRecords!: EntityTable<QuizRecord, 'id'>
  settings!: EntityTable<SettingsRow, 'key'>

  constructor() {
    super('ciji-db')
    this.version(1).stores({
      words: 'id, word, updatedAt, weak, focus, mastery, type',
      wordLearningRecords: 'id, wordId, word, date, type, result',
      dailyLearning: 'id, date, wordId, word',
      dailySnapshots: 'id, date',
      aiDailyPackages: 'id, date, kind, createdAt',
      quizRecords: 'id, date, word, correct',
      settings: 'key',
    })
  }
}

export const db = new CijiDB()

export interface DeviceSecrets {
  mimoApiKey: string
  maimemoAccessToken?: string
  maimemoRefreshToken?: string
  maimemoIdToken?: string
  maimemoUser?: { sub?: string; name?: string; preferred_username?: string; email?: string } | null
  maimemoTokenExpiresAt?: number | null
}

export interface AppState {
  settings: AppSettings
  words: WordRecord[]
  dayStats: DailySnapshotRow[]
  stories: StoryRecord[]
  reviews: ReviewBundle[]
  homeSummary: AiHomeSummary | null
  quizRecords: QuizRecord[]
  secrets: DeviceSecrets
  today: string
}

async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key)
  if (!row) return fallback
  return row.value as T
}

async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value })
}

function emptySecrets(): DeviceSecrets {
  return {
    mimoApiKey: '',
    maimemoAccessToken: undefined,
    maimemoRefreshToken: undefined,
    maimemoIdToken: undefined,
    maimemoUser: null,
    maimemoTokenExpiresAt: null,
  }
}

/** 从旧 localStorage（Capacitor/早期 Web）迁移到 IndexedDB */
export async function migrateFromLocalStorageIfAny(): Promise<boolean> {
  const legacyKeys = ['ciji.app.v1', 'wordtrail-settings']
  let migrated = false
  const raw = localStorage.getItem('ciji.app.v1')
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<AppData> & { settings?: AppSettings }
      const settings = { ...defaultSettings(), ...parsed.settings } as AppSettings
      settings.mimo = { ...mimoDefaults(), ...settings.mimo }
      await setSetting('appSettings', settings)
      const words = (parsed.words || []).map((w) => ({
        ...w,
        updatedAt: new Date().toISOString(),
      }))
      if (words.length) {
        await db.words.bulkPut(words)
        for (const w of words) {
          for (const h of w.history || []) {
            await db.wordLearningRecords.put({
              id: `${w.id}-${h.date}-${h.type}`,
              wordId: w.id,
              word: w.word,
              date: h.date,
              type: h.type,
              result: h.result,
            })
            await db.dailyLearning.put({
              id: `${h.date}-${w.id}`,
              date: h.date,
              wordId: w.id,
              word: w.word,
              type: h.type,
              mastery: w.mastery,
            })
          }
        }
      }
      const snaps = (parsed.dayStats || []).map((d) => ({ ...d, id: d.date }))
      if (snaps.length) await db.dailySnapshots.bulkPut(snaps)
      for (const s of parsed.stories || []) {
        await db.aiDailyPackages.put({
          id: s.id,
          date: s.date,
          kind: 'story',
          payload: s,
          createdAt: s.createdAt,
        })
      }
      for (const r of parsed.reviews || []) {
        await db.aiDailyPackages.put({
          id: `review-${r.date}`,
          date: r.date,
          kind: 'review',
          payload: r,
          createdAt: r.generatedAt,
        })
      }
      if (parsed.homeSummary) {
        await db.aiDailyPackages.put({
          id: `home-${parsed.homeSummary.generatedAt}`,
          date: todayKey(),
          kind: 'home',
          payload: parsed.homeSummary,
          createdAt: parsed.homeSummary.generatedAt,
        })
      }
      localStorage.removeItem('ciji.app.v1')
      migrated = true
    } catch {
      // ignore broken legacy payload
    }
  }
  for (const k of legacyKeys) localStorage.removeItem(k)
  return migrated
}

export async function loadAppState(): Promise<AppState> {
  await db.open()
  await migrateFromLocalStorageIfAny()

  let secrets = await getSetting<DeviceSecrets>('deviceSecrets', emptySecrets())
  const envKey = ((import.meta.env.VITE_MIMO_API_KEY as string | undefined) || '').trim()
  if (!secrets.mimoApiKey && envKey) {
    secrets = { ...secrets, mimoApiKey: envKey }
  }

  let settings = await getSetting<AppSettings | null>('appSettings', null)
  if (!settings) {
    // 真实接入：首次打开不写入 mock 单词
    settings = defaultSettings()
    settings = {
      ...settings,
      mimo: { ...settings.mimo, apiKey: secrets.mimoApiKey || settings.mimo.apiKey },
    }
    await setSetting('appSettings', settings)
  }

  settings = {
    ...defaultSettings(),
    ...settings,
    maimemo: { ...defaultSettings().maimemo, ...settings.maimemo },
    mimo: {
      ...mimoDefaults(),
      ...settings.mimo,
      // 本机 IndexedDB Key 优先；否则构建注入 / 环境 Key
      apiKey: secrets.mimoApiKey || settings.mimo?.apiKey || envKey || '',
    },
  }

  // 清理历史 mock：非 sample 模式下丢弃示例词，避免看起来像“假数据”
  if (settings.dataSource !== 'sample') {
    const existing = await db.words.toArray()
    const sampleOnly = existing.length > 0 && existing.every((w) => isLikelySampleWordId(w.id))
    if (sampleOnly) {
      const hasRealToken = Boolean(secrets.maimemoAccessToken)
      if (!hasRealToken) {
        await db.transaction(
          'rw',
          db.words,
          db.wordLearningRecords,
          db.dailyLearning,
          db.dailySnapshots,
          db.aiDailyPackages,
          async () => {
            const ids = new Set(existing.map((w) => w.id))
            await db.words.bulkDelete(existing.map((w) => w.id))
            const records = await db.wordLearningRecords.toArray()
            await db.wordLearningRecords.bulkDelete(records.filter((r) => ids.has(r.wordId)).map((r) => r.id))
            const daily = await db.dailyLearning.toArray()
            await db.dailyLearning.bulkDelete(daily.filter((d) => ids.has(d.wordId)).map((d) => d.id))
            await db.dailySnapshots.clear()
            await db.aiDailyPackages.clear()
          },
        )
      }
    }
  }

  const words = await db.words.toArray()
  const dayStats = await db.dailySnapshots.orderBy('date').toArray()
  const packages = await db.aiDailyPackages.toArray()
  const stories = packages.filter((p) => p.kind === 'story').map((p) => p.payload as StoryRecord)
  const reviews = packages.filter((p) => p.kind === 'review').map((p) => p.payload as ReviewBundle)
  const homes = packages.filter((p) => p.kind === 'home').map((p) => p.payload as AiHomeSummary)
  homes.sort((a, b) => (a.generatedAt < b.generatedAt ? 1 : -1))
  const quizRecords = await db.quizRecords.orderBy('date').reverse().toArray()

  return {
    settings,
    words,
    dayStats,
    stories: stories.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    reviews: reviews.sort((a, b) => (a.generatedAt < b.generatedAt ? 1 : -1)),
    homeSummary: homes[0] || buildLocalHomeSummary(words),
    quizRecords,
    secrets,
    today: todayKey(),
  }
}

export async function persistSettings(settings: AppSettings): Promise<void> {
  await setSetting('appSettings', settings)
}

export async function persistSecrets(secrets: DeviceSecrets): Promise<void> {
  await setSetting('deviceSecrets', secrets)
}

export async function upsertWords(words: WordRecord[]): Promise<void> {
  const now = new Date().toISOString()
  await db.transaction('rw', db.words, db.wordLearningRecords, db.dailyLearning, async () => {
    for (const w of words) {
      await db.words.put({ ...w, updatedAt: now })
      for (const h of w.history) {
        await db.wordLearningRecords.put({
          id: `${w.id}-${h.date}-${h.type}`,
          wordId: w.id,
          word: w.word,
          date: h.date,
          type: h.type,
          result: h.result,
        })
        await db.dailyLearning.put({
          id: `${h.date}-${w.id}`,
          date: h.date,
          wordId: w.id,
          word: w.word,
          type: h.type,
          mastery: w.mastery,
        })
      }
    }
  })
}

export async function putSnapshot(snapshot: DailySnapshotRow): Promise<void> {
  await db.dailySnapshots.put({ ...snapshot, id: snapshot.date })
}

export async function putStory(story: StoryRecord): Promise<void> {
  await db.aiDailyPackages.put({
    id: story.id,
    date: story.date,
    kind: 'story',
    payload: story,
    createdAt: story.createdAt,
  })
}

export async function putReview(review: ReviewBundle): Promise<void> {
  await db.aiDailyPackages.put({
    id: `review-${review.date}`,
    date: review.date,
    kind: 'review',
    payload: review,
    createdAt: review.generatedAt,
  })
}

export async function putHomeSummary(summary: AiHomeSummary): Promise<void> {
  await db.aiDailyPackages.put({
    id: `home-${summary.generatedAt}`,
    date: todayKey(),
    kind: 'home',
    payload: summary,
    createdAt: summary.generatedAt,
  })
}

export async function putQuizRecord(record: QuizRecord): Promise<void> {
  await db.quizRecords.put(record)
}

export async function resetToSampleData(): Promise<AppState> {
  const seeded = {
    settings: { ...defaultSettings(), dataSource: 'sample' as const },
    words: buildSeedWords(),
    dayStats: buildSeedDayStats(),
    stories: [],
    reviews: [],
    homeSummary: null,
    today: todayKey(),
  }
  await db.transaction(
    'rw',
    db.words,
    db.wordLearningRecords,
    db.dailyLearning,
    db.dailySnapshots,
    db.aiDailyPackages,
    async () => {
      await db.words.clear()
      await db.wordLearningRecords.clear()
      await db.dailyLearning.clear()
      await db.dailySnapshots.clear()
      await db.aiDailyPackages.clear()
      const now = new Date().toISOString()
      await db.words.bulkPut(seeded.words.map((w) => ({ ...w, updatedAt: now })))
      await db.dailySnapshots.bulkPut(seeded.dayStats.map((d) => ({ ...d, id: d.date })))
      for (const w of seeded.words) {
        for (const h of w.history) {
          await db.wordLearningRecords.put({
            id: `${w.id}-${h.date}-${h.type}`,
            wordId: w.id,
            word: w.word,
            date: h.date,
            type: h.type,
            result: h.result,
          })
          await db.dailyLearning.put({
            id: `${h.date}-${w.id}`,
            date: h.date,
            wordId: w.id,
            word: w.word,
            type: h.type,
            mastery: w.mastery,
          })
        }
      }
      const home = buildLocalHomeSummary(seeded.words)
      const review = buildLocalReview({
        settings: seeded.settings,
        words: seeded.words,
        dayStats: seeded.dayStats,
        stories: [],
        reviews: [],
        homeSummary: home,
        today: todayKey(),
      })
      await db.aiDailyPackages.put({
        id: `home-${home.generatedAt}`,
        date: todayKey(),
        kind: 'home',
        payload: home,
        createdAt: home.generatedAt,
      })
      await db.aiDailyPackages.put({
        id: `review-${review.date}`,
        date: review.date,
        kind: 'review',
        payload: review,
        createdAt: review.generatedAt,
      })
    },
  )
  await db.quizRecords.clear()
  const secrets = await getSetting<DeviceSecrets>('deviceSecrets', emptySecrets())
  await setSetting('appSettings', { ...seeded.settings, mimo: { ...mimoDefaults(), ...seeded.settings.mimo } })
  await setSetting('deviceSecrets', secrets)
  return loadAppState()
}

export interface BackupFile {
  app: 'ciji'
  version: 1
  exportedAt: string
  settings: Omit<AppSettings, 'mimo'> & { mimo: { baseUrl: string; model: string } }
  words: WordRecord[]
  wordLearningRecords: WordLearningRecord[]
  dailyLearning: DailyLearningRow[]
  dailySnapshots: DailySnapshotRow[]
  aiDailyPackages: AiPackageRow[]
  quizRecords: QuizRecord[]
}

export async function exportBackup(): Promise<BackupFile> {
  const settings = await getSetting<AppSettings>('appSettings', defaultSettings())
  return {
    app: 'ciji',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: {
      ...settings,
      mimo: {
        baseUrl: settings.mimo?.baseUrl || mimoDefaults().baseUrl,
        model: settings.mimo?.model || mimoDefaults().model,
      },
    },
    words: await db.words.toArray(),
    wordLearningRecords: await db.wordLearningRecords.toArray(),
    dailyLearning: await db.dailyLearning.toArray(),
    dailySnapshots: await db.dailySnapshots.toArray(),
    aiDailyPackages: await db.aiDailyPackages.toArray(),
    quizRecords: await db.quizRecords.toArray(),
  }
}

export async function importBackup(data: BackupFile): Promise<AppState> {
  if (!data || data.app !== 'ciji') throw new Error('备份文件格式不正确')
  await db.transaction(
    'rw',
    db.words,
    db.wordLearningRecords,
    db.dailyLearning,
    db.dailySnapshots,
    db.aiDailyPackages,
    async () => {
      await db.words.clear()
      await db.wordLearningRecords.clear()
      await db.dailyLearning.clear()
      await db.dailySnapshots.clear()
      await db.aiDailyPackages.clear()
      const now = new Date().toISOString()
      await db.words.bulkPut((data.words || []).map((w) => ({ ...w, updatedAt: w.updatedAt || now })))
      await db.wordLearningRecords.bulkPut(data.wordLearningRecords || [])
      await db.dailyLearning.bulkPut(data.dailyLearning || [])
      await db.dailySnapshots.bulkPut(data.dailySnapshots || [])
      await db.aiDailyPackages.bulkPut(data.aiDailyPackages || [])
    },
  )
  await db.quizRecords.clear()
  await db.quizRecords.bulkPut(data.quizRecords || [])
  const secrets = await getSetting<DeviceSecrets>('deviceSecrets', emptySecrets())
  const prev = await getSetting<AppSettings>('appSettings', defaultSettings())
  const nextSettings: AppSettings = {
    ...prev,
    ...data.settings,
    maimemo: { ...prev.maimemo, ...data.settings.maimemo, accessToken: '' },
    mimo: {
      baseUrl: data.settings.mimo?.baseUrl || mimoDefaults().baseUrl,
      model: data.settings.mimo?.model || mimoDefaults().model,
      apiKey: secrets.mimoApiKey || '',
    },
  }
  await setSetting('appSettings', nextSettings)
  return loadAppState()
}

export async function clearMaimemoConnection(): Promise<void> {
  const secrets = await getSetting<DeviceSecrets>('deviceSecrets', emptySecrets())
  await setSetting('deviceSecrets', {
    ...secrets,
    maimemoAccessToken: undefined,
    maimemoRefreshToken: undefined,
    maimemoIdToken: undefined,
    maimemoUser: null,
    maimemoTokenExpiresAt: null,
  })
  const settings = await getSetting<AppSettings>('appSettings', defaultSettings())
  await setSetting('appSettings', {
    ...settings,
    maimemo: { ...settings.maimemo, accessToken: '', accountId: '' },
  })
}

export function emptyDeviceSecrets(): DeviceSecrets {
  return emptySecrets()
}
