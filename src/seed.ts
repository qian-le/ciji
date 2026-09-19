import type { DayStats, WordRecord } from './types'

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

export function buildSeedWords(): WordRecord[] {
  const today = daysAgo(0)
  return [
    {
      id: 'w-maintain',
      word: 'maintain',
      phonetic: '/meɪnˈteɪn/',
      meaning: 'v. 维持；保持',
      type: 'review',
      mastery: 'weak',
      frequency: 4,
      weak: true,
      focus: true,
      history: [
        { date: daysAgo(0), type: 'review', result: 'partial' },
        { date: daysAgo(2), type: 'review', result: 'forgot' },
        { date: daysAgo(5), type: 'new', result: 'partial' },
        { date: daysAgo(8), type: 'new', result: 'remembered' },
      ],
    },
    {
      id: 'w-preserve',
      word: 'preserve',
      phonetic: '/prɪˈzɜːv/',
      meaning: 'v. 保护；保存',
      type: 'review',
      mastery: 'weak',
      frequency: 3,
      weak: true,
      focus: true,
      history: [
        { date: daysAgo(0), type: 'review', result: 'forgot' },
        { date: daysAgo(3), type: 'review', result: 'partial' },
        { date: daysAgo(7), type: 'new', result: 'partial' },
      ],
    },
    {
      id: 'w-sustain',
      word: 'sustain',
      phonetic: '/səˈsteɪn/',
      meaning: 'v. 维持；支撑',
      type: 'new',
      mastery: 'warn',
      frequency: 2,
      weak: false,
      focus: true,
      history: [
        { date: today, type: 'new', result: 'partial' },
        { date: daysAgo(1), type: 'new', result: 'partial' },
      ],
    },
    {
      id: 'w-adequate',
      word: 'adequate',
      phonetic: '/ˈædɪkwət/',
      meaning: 'adj. 足够的；合格的',
      type: 'new',
      mastery: 'warn',
      frequency: 3,
      weak: false,
      focus: true,
      history: [
        { date: today, type: 'new', result: 'partial' },
        { date: daysAgo(4), type: 'new', result: 'remembered' },
      ],
    },
    {
      id: 'w-circumstance',
      word: 'circumstance',
      phonetic: '/ˈsɜːkəmstəns/',
      meaning: 'n. 情况；环境',
      type: 'review',
      mastery: 'good',
      frequency: 2,
      weak: false,
      focus: false,
      history: [
        { date: today, type: 'review', result: 'remembered' },
        { date: daysAgo(6), type: 'new', result: 'remembered' },
      ],
    },
    {
      id: 'w-reluctant',
      word: 'reluctant',
      phonetic: '/rɪˈlʌktənt/',
      meaning: 'adj. 不情愿的；勉强的',
      type: 'new',
      mastery: 'weak',
      frequency: 2,
      weak: true,
      focus: true,
      history: [
        { date: today, type: 'new', result: 'forgot' },
        { date: daysAgo(2), type: 'new', result: 'partial' },
      ],
    },
    {
      id: 'w-encounter',
      word: 'encounter',
      phonetic: '/ɪnˈkaʊntə(r)/',
      meaning: 'v./n. 遇到；遭遇',
      type: 'review',
      mastery: 'good',
      frequency: 3,
      weak: false,
      focus: false,
      history: [
        { date: today, type: 'review', result: 'remembered' },
        { date: daysAgo(3), type: 'review', result: 'remembered' },
        { date: daysAgo(9), type: 'new', result: 'remembered' },
      ],
    },
    {
      id: 'w-eventually',
      word: 'eventually',
      phonetic: '/ɪˈventʃuəli/',
      meaning: 'adv. 最终；终于',
      type: 'review',
      mastery: 'good',
      frequency: 2,
      weak: false,
      focus: false,
      history: [
        { date: today, type: 'review', result: 'remembered' },
        { date: daysAgo(5), type: 'new', result: 'remembered' },
      ],
    },
    {
      id: 'w-significant',
      word: 'significant',
      phonetic: '/sɪɡˈnɪfɪkənt/',
      meaning: 'adj. 重要的；显著的',
      type: 'new',
      mastery: 'warn',
      frequency: 3,
      weak: false,
      focus: true,
      history: [
        { date: today, type: 'new', result: 'partial' },
        { date: daysAgo(4), type: 'new', result: 'partial' },
      ],
    },
    {
      id: 'w-adapt',
      word: 'adapt',
      phonetic: '/əˈdæpt/',
      meaning: 'v. 适应；改编',
      type: 'review',
      mastery: 'weak',
      frequency: 4,
      weak: true,
      focus: true,
      history: [
        { date: today, type: 'review', result: 'partial' },
        { date: daysAgo(2), type: 'review', result: 'forgot' },
        { date: daysAgo(6), type: 'review', result: 'partial' },
        { date: daysAgo(11), type: 'new', result: 'remembered' },
      ],
    },
  ]
}

export function buildSeedDayStats(): DayStats[] {
  const volumes = [62, 84, 50, 93, 74, 88, 104]
  return volumes.map((total, i) => {
    const date = daysAgo(6 - i)
    const newCount = Math.round(total * 0.32)
    const reviewCount = total - newCount
    const focusCount = Math.max(4, Math.round(total * 0.1))
    const score = Math.min(96, Math.max(58, Math.round(70 + total / 8 - (i === 3 ? 8 : 0))))
    return {
      date,
      newCount,
      reviewCount,
      totalCount: total,
      focusCount,
      score,
    }
  })
}
