import type {
  AiHomeSummary,
  AppData,
  ConfusableGroup,
  DayStats,
  ReviewBundle,
  ReviewInsight,
  WordRecord,
} from './types'

export function todayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10)
}

export function formatMonthDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export function getTodayStats(words: WordRecord[], target: number, date = todayKey()): DayStats {
  const todayWords = words.filter((w) => w.history.some((h) => h.date === date))
  const newCount = todayWords.filter((w) => w.type === 'new').length
  const reviewCount = todayWords.filter((w) => w.type === 'review').length
  const focusCount = todayWords.filter((w) => w.focus || w.weak).length
  const weak = todayWords.filter((w) => w.weak).length
  const volumeScore = Math.min(60, Math.round((todayWords.length / Math.max(target, 1)) * 60))
  const qualityScore = todayWords.length
    ? Math.round(((todayWords.length - weak) / todayWords.length) * 40)
    : 0
  return {
    date,
    newCount,
    reviewCount,
    totalCount: todayWords.length,
    focusCount,
    score: todayWords.length ? Math.min(100, volumeScore + qualityScore) : 0,
  }
}

export function getTodayWords(words: WordRecord[], date = todayKey()): WordRecord[] {
  return words.filter((w) => w.history.some((h) => h.date === date))
}

export function getFocusWords(words: WordRecord[], limit = 6): WordRecord[] {
  return [...words]
    .filter((w) => w.focus || w.weak)
    .sort((a, b) => {
      const aw = a.weak ? 2 : 1
      const bw = b.weak ? 2 : 1
      if (aw !== bw) return bw - aw
      return b.frequency - a.frequency
    })
    .slice(0, limit)
}

export function getStreak(dayStats: DayStats[]): number {
  const set = new Set(dayStats.filter((d) => d.totalCount > 0).map((d) => d.date))
  let streak = 0
  const cursor = new Date()
  for (let i = 0; i < 60; i++) {
    const key = todayKey(cursor)
    if (set.has(key)) streak += 1
    else if (i > 0) break
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

export function pickStoryWords(words: WordRecord[], min = 8, max = 15): WordRecord[] {
  const pool = [...words].sort((a, b) => {
    const score = (w: WordRecord) => (w.weak ? 3 : 0) + (w.focus ? 2 : 0) + w.frequency
    return score(b) - score(a)
  })
  const weak = pool.filter((w) => w.weak || w.focus)
  const others = pool.filter((w) => !w.weak && !w.focus)
  const picked = weak.slice(0, max)
  for (const w of others) {
    if (picked.length >= max) break
    if (picked.length < min) picked.push(w)
  }
  return picked.slice(0, max)
}

export function detectConfusables(words: WordRecord[]): ConfusableGroup[] {
  const groups: ConfusableGroup[] = []
  const byWord = new Map(words.map((w) => [w.word.toLowerCase(), w]))
  const candidates: string[][] = [
    ['maintain', 'preserve', 'sustain'],
    ['adequate', 'sufficient'],
    ['adapt', 'adopt'],
    ['affect', 'effect'],
    ['rise', 'raise'],
  ]
  for (const group of candidates) {
    const hit = group.filter((g) => byWord.has(g))
    if (hit.length >= 2) {
      groups.push({
        title: hit.join(' / '),
        words: hit,
        note: '这几个词在今天数据里同时出现，建议对比语境后再记，而不是只背中文释义。',
      })
    }
  }
  return groups
}

export function buildLocalReview(data: AppData): ReviewBundle {
  const words = getTodayWords(data.words)
  const focus = getFocusWords(data.words, 8)
  const confusables = detectConfusables(data.words)
  const weak = focus.filter((w) => w.weak)
  const stats = getTodayStats(data.words, data.settings.targetDaily)

  const insights: ReviewInsight[] = []
  if (weak.length) {
    insights.push({
      id: 'priority',
      icon: '🎯',
      title: '最需要优先处理',
      body: `${weak.map((w) => w.word).join('、')} 掌握状态偏弱，建议睡前只重看这几个，不必把今日全部单词再过一遍。`,
    })
  }
  if (confusables.length) {
    insights.push({
      id: 'confusable',
      icon: '🧩',
      title: '问题更像“近义混淆”',
      body: `${confusables[0].title} 都可能出现，但边界不清晰。用三句话建立不同语境，会比重复看中文释义更有效。`,
    })
  }
  const essayWords = focus.filter((w) => /adj\.|v\./.test(w.meaning)).slice(0, 3)
  if (essayWords.length) {
    insights.push({
      id: 'essay',
      icon: '✍️',
      title: '可顺手服务四级作文',
      body: `${essayWords.map((w) => w.word).join('、')} 很适合进入作文表达库，建议各保留一个稳定、安全的句型。`,
    })
  }
  if (!insights.length) {
    insights.push({
      id: 'steady',
      icon: '🌿',
      title: '今天节奏不错',
      body: '薄弱词不多，可以快速过一遍重点词，然后把时间留给例句和语境理解。',
    })
  }

  const summary =
    words.length === 0
      ? '今天还没有同步到学习数据。先同步墨墨，或导入今日单词，再生成复盘会更准确。'
      : `今日共接触 ${stats.totalCount} 词（新学 ${stats.newCount} / 复习 ${stats.reviewCount}）。${weak.length ? `其中 ${weak.length} 个词需要强化：${weak.map((w) => w.word).slice(0, 4).join('、')}。` : '整体掌握较稳，可继续保持语境复习。'}`

  return {
    date: todayKey(),
    summary,
    topWords: focus.slice(0, 6).map((w) => w.word),
    confusables,
    suggestions: weak.length
      ? [
          `今晚优先重看 ${weak.slice(0, 3).map((w) => w.word).join(' / ')}`,
          '不建议继续盲目加新词，先把近期反复出现的词稳住',
          '为每个薄弱词写一句与自己生活相关的英文句子',
        ]
      : [
          '可以适量推进新词，但保持复习占比',
          '用今日故事再走一遍语境',
          '记录 1–2 个你想写进作文的表达',
        ],
    insights,
    generatedAt: new Date().toISOString(),
    source: 'local',
  }
}

export function buildLocalHomeSummary(words: WordRecord[]): AiHomeSummary {
  const focus = getFocusWords(words, 5)
  const weak = focus.filter((w) => w.weak)
  if (!words.length) {
    return {
      text: '还没有学习数据。同步墨墨后，这里会总结你今天真正需要再看的词。',
      generatedAt: new Date().toISOString(),
      source: 'local',
    }
  }
  if (weak.length) {
    return {
      text: `今天你学习的词汇中，抽象动词和形容词占比较高，其中 ${weak
        .map((w) => w.word)
        .slice(0, 3)
        .join(' / ')} 等词建议结合语境再次强化。`,
      generatedAt: new Date().toISOString(),
      source: 'local',
    }
  }
  return {
    text: `今天完成得比较稳。重点不是“背了多少”，而是确认 ${focus
      .map((w) => w.word)
      .slice(0, 3)
      .join(' / ')} 是否真的进入了长期记忆。`,
    generatedAt: new Date().toISOString(),
    source: 'local',
  }
}

export function masteryLabel(m: WordRecord['mastery']): string {
  if (m === 'good') return '掌握良好'
  if (m === 'warn') return '掌握一般'
  return '需要加强'
}
