import type { AppData, AppSettings } from './types'
import { mimoDefaults } from './config'

function envMimoKey(): string {
  const v = (import.meta.env.VITE_MIMO_API_KEY as string | undefined) || ''
  return v.trim()
}

export function defaultSettings(): AppSettings {
  const mimo = mimoDefaults()
  return {
    // 真实接入：默认墨墨开放 API，不再自动灌入 mock 示例词
    dataSource: 'maimemo',
    maimemo: {
      baseUrl: 'https://open.maimemo.com/open',
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
      // 构建时可选注入（来自 GitHub Secret / 本地 .env，不进 git）
      // 设备上仍以 IndexedDB 中的 Key 优先
      apiKey: envMimoKey(),
      model: mimo.model,
    },
    lastSyncAt: null,
    targetDaily: 120,
  }
}

export function emptyAppData(): AppData {
  return {
    settings: defaultSettings(),
    words: [],
    dayStats: [],
    stories: [],
    reviews: [],
    homeSummary: null,
    today: new Date().toISOString().slice(0, 10),
  }
}

/** 仅在用户主动选择「示例数据」时使用 */
export function seedAppData(): AppData {
  return emptyAppData()
}

export function isLikelySampleWordId(id?: string): boolean {
  return typeof id === 'string' && /^w-/.test(id)
}
