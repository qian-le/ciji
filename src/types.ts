export type Mastery = 'good' | 'warn' | 'weak'
export type WordType = 'new' | 'review'
export type TabKey = 'home' | 'words' | 'story' | 'review' | 'quiz' | 'trends' | 'settings'

export interface WordHistoryItem {
  date: string
  type: WordType
  result: 'remembered' | 'forgot' | 'partial'
}

export interface WordLearningRecord {
  id: string
  wordId: string
  word: string
  date: string
  type: WordType
  result: 'remembered' | 'forgot' | 'partial'
}

export interface ConfusableWord {
  word: string
  note: string
}

export interface WordAiContent {
  exampleEn?: string
  exampleZh?: string
  collocations?: string[]
  usage?: string
  confusables?: ConfusableWord[]
  cet4Value?: string
  generatedAt?: string
}

export interface WordRecord {
  id: string
  word: string
  phonetic?: string
  meaning: string
  type: WordType
  mastery: Mastery
  frequency: number
  weak: boolean
  focus: boolean
  note?: string
  history: WordHistoryItem[]
  ai?: WordAiContent
  updatedAt?: string
}

export interface DayStats {
  date: string
  newCount: number
  reviewCount: number
  totalCount: number
  focusCount: number
  score: number
}

export interface StoryRecord {
  id: string
  date: string
  mode: StoryMode
  title: string
  en: string
  zh: string
  words: string[]
  createdAt: string
}

export type StoryMode = 'daily' | 'campus' | 'cet4' | 'random'

export interface ConfusableGroup {
  title: string
  words: string[]
  note: string
}

export interface ReviewInsight {
  id: string
  icon: string
  title: string
  body: string
}

export interface ReviewBundle {
  date: string
  summary: string
  topWords: string[]
  confusables: ConfusableGroup[]
  suggestions: string[]
  insights: ReviewInsight[]
  generatedAt: string
  source: 'ai' | 'local'
}

export interface AiHomeSummary {
  text: string
  generatedAt: string
  source: 'ai' | 'local'
}

export interface QuizRecord {
  id: string
  date: string
  word: string
  wordId: string
  meaning: string
  options: string[]
  /** null = 未作答；true/false = 对/错 */
  correct: boolean | null
  answeredAt: string
}

export interface MaimemoSettings {
  baseUrl: string
  clientId: string
  redirectUri: string
  scope: string
  /** 同步时使用的 token（运行时从 IndexedDB secrets 注入） */
  accessToken: string
  accountId: string
  connected?: boolean
  userLabel?: string
}

export interface MimoSettings {
  baseUrl: string
  apiKey: string
  model: string
}

export interface AppSettings {
  dataSource: 'sample' | 'maimemo' | 'import'
  maimemo: MaimemoSettings
  mimo: MimoSettings
  lastSyncAt: string | null
  targetDaily: number
}

export interface AppData {
  settings: AppSettings
  words: WordRecord[]
  dayStats: DayStats[]
  stories: StoryRecord[]
  reviews: ReviewBundle[]
  homeSummary: AiHomeSummary | null
  quizRecords?: QuizRecord[]
  today: string
}
