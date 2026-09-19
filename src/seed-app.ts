import type { AppData, AppSettings } from './types'
import { buildSeedDayStats, buildSeedWords } from './seed'
import { mimoDefaults } from './config'

export function defaultSettings(): AppSettings {
  const mimo = mimoDefaults()
  return {
    dataSource: 'sample',
    maimemo: {
      baseUrl: 'https://open.maimemo.com',
      clientId: '',
      redirectUri: '',
      scope: 'openid profile',
      accessToken: '',
      accountId: '',
      connected: false,
      userLabel: '',
    },
    mimo: {
      baseUrl: mimo.baseUrl,
      apiKey: '',
      model: mimo.model,
    },
    lastSyncAt: null,
    targetDaily: 120,
  }
}

export function seedAppData(): AppData {
  return {
    settings: defaultSettings(),
    words: buildSeedWords(),
    dayStats: buildSeedDayStats(),
    stories: [],
    reviews: [],
    homeSummary: null,
    today: new Date().toISOString().slice(0, 10),
  }
}
