import type {
  AiHomeSummary,
  MimoSettings,
  QuizRecord,
  ReviewBundle,
  StoryMode,
  StoryRecord,
  WordAiContent,
  WordRecord,
} from '../types'
import { chatComplete, extractJson, isOnline, offlineError } from './api'
import { buildLocalHomeSummary, buildLocalReview, pickStoryWords, todayKey } from '../analyzer'

const FALLBACK_STORY_EN =
  'Under difficult circumstances, Leo tried to maintain his study routine before the final exam. He was initially reluctant to join a study group, but the support he received was more than adequate. During the week, he encountered several unfamiliar problems and eventually learned that asking for help was not a weakness.'
const FALLBACK_STORY_ZH =
  '在困难的情况下，Leo 仍努力维持期末考试前的学习节奏。他一开始不太愿意参加学习小组，但后来发现同学们提供的帮助完全够用。那一周里，他遇到了几个陌生问题，并最终意识到，寻求帮助并不是软弱。'

function storyModePrompt(mode: StoryMode): string {
  switch (mode) {
    case 'campus':
      return '校园生活场景，自然、贴近大学生日常'
    case 'cet4':
      return 'CET-4 阅读/写作语域，句子可以稍正式，但保持可读'
    case 'random':
      return '随机有趣主题，避免老套励志模板'
    default:
      return '日常故事，轻松真实，避免说教'
  }
}

function ensureOnline() {
  if (!isOnline()) throw offlineError()
}

export async function generateStory(params: {
  settings: MimoSettings
  words: WordRecord[]
  mode: StoryMode
}): Promise<StoryRecord> {
  ensureOnline()
  const picked = pickStoryWords(params.words, 8, 15)
  const date = todayKey()
  if (!picked.length) {
    return {
      id: `story-${date}-empty`,
      date,
      mode: params.mode,
      title: '今日暂无故事',
      en: 'Sync today’s words first, then come back for a story built from them.',
      zh: '请先同步今日单词，再生成故事。',
      words: [],
      createdAt: new Date().toISOString(),
    }
  }

  const wordList = picked.map((w) => `${w.word} (${w.meaning})`).join(', ')
  const prompt = `你是英语学习内容设计师。请只使用给定单词写一篇短故事，不要强行塞入全部词。

要求：
- 模式：${storyModePrompt(params.mode)}
- 使用其中 8~12 个词，每个词在故事中自然出现
- 英文 90~140 词
- 对应中文翻译
- 标题简短
- 输出严格 JSON：{"title":"...","en":"...","zh":"...","used":["word1","word2"]}

今日单词：
${wordList}`

  try {
    const raw = await chatComplete(params.settings, [
      { role: 'system', content: 'You output only valid JSON for vocabulary learning stories.' },
      { role: 'user', content: prompt },
    ])
    const json = extractJson<{ title?: string; en?: string; zh?: string; used?: string[] }>(raw)
    if (!json.en || !json.zh) throw new Error('故事字段不完整')
    return {
      id: `story-${date}-${Date.now()}`,
      date,
      mode: params.mode,
      title: json.title || 'AI 今日故事',
      en: json.en,
      zh: json.zh,
      words: json.used || picked.map((w) => w.word).slice(0, 12),
      createdAt: new Date().toISOString(),
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('无网络')) throw e
    const fallbackWords = picked.map((w) => w.word)
    return {
      id: `story-${date}-fallback-${Date.now()}`,
      date,
      mode: params.mode,
      title: '示例故事（AI 暂不可用）',
      en: FALLBACK_STORY_EN,
      zh: FALLBACK_STORY_ZH,
      words: fallbackWords.filter((w) => FALLBACK_STORY_EN.toLowerCase().includes(w.toLowerCase())),
      createdAt: new Date().toISOString(),
    }
  }
}

export async function generateReview(params: {
  settings: MimoSettings
  words: WordRecord[]
  allWords: WordRecord[]
}): Promise<ReviewBundle> {
  const local = buildLocalReview({
    settings: {
      dataSource: 'sample',
      maimemo: {
        baseUrl: '',
        clientId: '',
        redirectUri: '',
        scope: '',
        accessToken: '',
        accountId: '',
      },
      mimo: params.settings,
      lastSyncAt: null,
      targetDaily: 120,
    },
    words: params.allWords,
    dayStats: [],
    stories: [],
    reviews: [],
    homeSummary: null,
    today: todayKey(),
  })

  if (!params.settings.apiKey) return local
  if (!isOnline()) throw offlineError()

  const focus = params.words.slice(0, 20)
  const prompt = `根据今日学习单词，生成个人学习复盘。只输出 JSON。

字段：
{
  "summary": "中文今日总结 2-3 句",
  "topWords": ["最值得重看的单词 4-6 个"],
  "confusables": [{"title":"a / b","words":["a","b"],"note":"清晰区别，中文"}],
  "suggestions": ["今日建议 2-3 条，中文"],
  "insights": [{"icon":"🎯","title":"...","body":"中文说明"}]
}

今日单词：
${focus.map((w) => `${w.word} | ${w.meaning} | ${w.type} | ${w.mastery} | 出现${w.frequency}次`).join('\n')}`

  try {
    const raw = await chatComplete(params.settings, [
      { role: 'system', content: 'You are a Chinese vocabulary study coach. Output only JSON.' },
      { role: 'user', content: prompt },
    ])
    const json = extractJson<{
      summary?: string
      topWords?: string[]
      confusables?: { title?: string; words?: string[]; note?: string }[]
      suggestions?: string[]
      insights?: { icon?: string; title?: string; body?: string }[]
    }>(raw)

    return {
      date: todayKey(),
      summary: json.summary || local.summary,
      topWords: json.topWords?.length ? json.topWords : local.topWords,
      confusables: (json.confusables || local.confusables)
        .filter((c) => c && (c.title || c.words?.length))
        .map((c) => ({
          title: c.title || (c.words || []).join(' / '),
          words: c.words || [],
          note: c.note || '',
        })),
      suggestions: json.suggestions?.length ? json.suggestions : local.suggestions,
      insights: (json.insights || local.insights).map((item, i) => ({
        id: `ai-${i}`,
        icon: item.icon || '🧠',
        title: item.title || '提示',
        body: item.body || '',
      })),
      generatedAt: new Date().toISOString(),
      source: 'ai',
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('无网络')) throw e
    return local
  }
}

export async function generateHomeSummary(params: {
  settings: MimoSettings
  words: WordRecord[]
}): Promise<AiHomeSummary> {
  const local = buildLocalHomeSummary(params.words)
  if (!params.settings.apiKey) return local
  if (!isOnline()) throw offlineError()
  const focus = params.words.filter((w) => w.focus || w.weak).slice(0, 8)
  if (!focus.length) return local
  const prompt = `用 1-2 句中文总结今日背单词情况，语气自然，不要套话。指出最需要再看的 2-3 个词。
单词：
${focus.map((w) => `${w.word} ${w.meaning} ${w.mastery}`).join('；')}`
  try {
    const text = await chatComplete(params.settings, [
      { role: 'system', content: '你是简洁的中文学习助手。' },
      { role: 'user', content: prompt },
    ])
    return { text: text.trim(), generatedAt: new Date().toISOString(), source: 'ai' }
  } catch (e) {
    if (e instanceof Error && e.message.includes('无网络')) throw e
    return local
  }
}

export async function generateWordAi(params: {
  settings: MimoSettings
  word: WordRecord
}): Promise<WordAiContent> {
  if (!params.settings.apiKey) {
    return {
      exampleEn: defaultExample(params.word.word),
      exampleZh: '',
      collocations: [],
      usage: '配置 MiMo API 后，可生成更贴合考级与语境的内容。',
      confusables: [],
      cet4Value: '适合纳入四级作文/阅读表达库，优先掌握搭配与例句。',
      generatedAt: new Date().toISOString(),
    }
  }
  ensureOnline()
  const prompt = `为英语学习者生成单词精讲，只输出 JSON。

单词：${params.word.word}
释义：${params.word.meaning}

{
  "exampleEn": "高质量英文例句，突出该词真实用法",
  "exampleZh": "中文翻译",
  "collocations": ["常见搭配 4 个"],
  "usage": "用法说明，中文，简洁",
  "confusables": [{"word":"近义词","note":"与本词的区别，中文"}],
  "cet4Value": "CET-4 写作/阅读价值，中文，给一个可复用句型"
}`
  try {
    const raw = await chatComplete(params.settings, [
      { role: 'system', content: 'You are a precise English vocabulary editor. Output only JSON.' },
      { role: 'user', content: prompt },
    ])
    const json = extractJson<WordAiContent>(raw)
    return { ...json, generatedAt: new Date().toISOString() }
  } catch (e) {
    if (e instanceof Error && e.message.includes('无网络')) throw e
    return {
      exampleEn: defaultExample(params.word.word),
      exampleZh: 'AI 暂不可用，已展示本地示例。',
      collocations: [],
      usage: '稍后可在设置中检查 MiMo API Key 与模型名。',
      confusables: [],
      cet4Value: '建议保留一个安全句型，便于作文复用。',
      generatedAt: new Date().toISOString(),
    }
  }
}

export function buildQuizSet(words: WordRecord[], limit = 8): QuizRecord[] {
  const pool = [...words].sort((a, b) => {
    const score = (w: WordRecord) => (w.weak ? 3 : 0) + (w.focus ? 2 : 0) + w.frequency
    return score(b) - score(a)
  })
  const selected = pool.slice(0, limit)
  return selected.map((w, i) => {
    const distractors = pool
      .filter((x) => x.id !== w.id)
      .sort(() => Math.random() - 0.5)
      .slice(0, 3)
      .map((x) => x.meaning)
    const options = [...distractors, w.meaning].sort(() => Math.random() - 0.5)
    return {
      id: `quiz-${todayKey()}-${w.id}-${i}-${Date.now()}`,
      date: todayKey(),
      word: w.word,
      wordId: w.id,
      meaning: w.meaning,
      options,
      correct: null,
      answeredAt: '',
    }
  })
}

function defaultExample(word: string): string {
  return `Students should learn how to ${word} a clear and practical study habit.`
}
