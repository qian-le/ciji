import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppSettings, QuizRecord, StoryMode, TabKey, WordRecord } from './types'
import {
  buildLocalHomeSummary,
  buildLocalReview,
  formatMonthDay,
  getFocusWords,
  getStreak,
  getTodayStats,
  getTodayWords,
  masteryLabel,
  todayKey,
} from './analyzer'
import {
  clearMaimemoConnection,
  exportBackup,
  importBackup,
  loadAppState,
  persistSecrets,
  persistSettings,
  putHomeSummary,
  putQuizRecord,
  putReview,
  putSnapshot,
  putStory,
  resetToSampleData,
  upsertWords,
  type AppState,
  type BackupFile,
} from './db'
import { buildSeedDayStats } from './seed'
import { fetchMaimemoStudyBundle, isOnline, normalizeSyncWords, parseImportPayload, testMaimemoToken, testMimoConnection } from './services/api'
import { buildQuizSet, generateHomeSummary, generateReview, generateStory, generateWordAi } from './services/ai'
import {
  beginMaimemoLogin,
  completeMaimemoCallback,
  extractSearchFromCallbackHash,
  isOAuthCallbackHash,
} from './services/oidc'
import { maimemoConfig } from './config'
import { Banner, BottomNav, Empty, MiniChart, SectionTitle, Toast } from './components'
import { UpdatePanel } from './components/UpdatePanel'

function masteryClass(m: WordRecord['mastery']) {
  return m === 'good' ? 'm-good' : m === 'warn' ? 'm-warn' : 'm-bad'
}

function highlightStory(text: string, words: string[], onWord: (w: string) => void) {
  if (!words.length) return text
  const sorted = [...words].sort((a, b) => b.length - a.length)
  const escaped = sorted.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi')
  const parts = text.split(re)
  return parts.map((part, i) => {
    const hit = sorted.find((w) => w.toLowerCase() === part.toLowerCase())
    if (!hit) return <span key={i}>{part}</span>
    return (
      <mark key={i} onClick={() => onWord(hit)} role="button">
        {part}
      </mark>
    )
  })
}

function userLabelOf(user: AppState['secrets']['maimemoUser']): string {
  if (!user) return ''
  return user.name || user.preferred_username || user.email || user.sub || '已登录用户'
}

export default function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [tab, setTab] = useState<TabKey>('home')
  const [selectedWord, setSelectedWord] = useState<string | null>(null)
  const [wordFilter, setWordFilter] = useState<'all' | 'new' | 'review' | 'weak' | 'focus'>('all')
  const [storyMode, setStoryMode] = useState<StoryMode>('campus')
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [importText, setImportText] = useState('')
  const [mimoKeyInput, setMimoKeyInput] = useState('')
  const [oauthError, setOauthError] = useState<string | null>(null)
  const [quiz, setQuiz] = useState<QuizRecord[] | null>(null)
  const [quizIndex, setQuizIndex] = useState(0)
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))

  const reload = useCallback(async () => {
    const next = await loadAppState()
    setState(next)
    setMimoKeyInput(next.secrets.mimoApiKey || '')
    return next
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const s = await loadAppState()
        if (!cancelled) {
          setState(s)
          setMimoKeyInput(s.secrets.mimoApiKey || '')
        }
      } catch (e) {
        if (!cancelled) setToast(e instanceof Error ? e.message : '本地数据库打开失败')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  // OAuth callback: #/auth/callback?code=...
  useEffect(() => {
    const hash = window.location.hash || ''
    if (!isOAuthCallbackHash(hash)) return
    const search = extractSearchFromCallbackHash(hash)
    setBusy('完成墨墨授权…')
    ;(async () => {
      try {
        const { tokens, user } = await completeMaimemoCallback(search)
        const current = await loadAppState()
        const label = userLabelOf(user)
        const settings: AppSettings = {
          ...current.settings,
          dataSource: 'maimemo',
          maimemo: {
            ...current.settings.maimemo,
            connected: true,
            userLabel: label,
            accessToken: tokens.access_token,
            accountId: user?.sub || current.settings.maimemo.accountId,
          },
        }
        await persistSettings(settings)
        await persistSecrets({
          ...current.secrets,
          maimemoAccessToken: tokens.access_token,
          maimemoRefreshToken: tokens.refresh_token,
          maimemoIdToken: tokens.id_token,
          maimemoUser: user,
          maimemoTokenExpiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null,
        })
        window.history.replaceState(null, '', window.location.pathname + window.location.search)
        setTab('home')
        setShowSettings(true)
        await reload()
        setToast(user ? `墨墨已连接：${label}` : '墨墨已连接')
      } catch (e) {
        setOauthError(e instanceof Error ? e.message : '授权失败')
        window.history.replaceState(null, '', window.location.pathname + window.location.search)
        setToast(e instanceof Error ? e.message : '授权失败')
      } finally {
        setBusy(null)
      }
    })()
  }, [reload])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2800)
    return () => clearTimeout(t)
  }, [toast])

  const [maimemoTokenInput, setMaimemoTokenInput] = useState('')
  const [showOidcAdvanced, setShowOidcAdvanced] = useState(Boolean(maimemoConfig().clientId))

  const data = state
  const todayWords = useMemo(() => (data ? getTodayWords(data.words) : []), [data])
  const todayStats = useMemo(
    () => (data ? getTodayStats(data.words, data.settings.targetDaily) : null),
    [data],
  )
  const focusWords = useMemo(() => (data ? getFocusWords(data.words, 6) : []), [data])
  const streak = useMemo(() => {
    if (!data) return 0
    const stats = data.dayStats.length ? data.dayStats : buildSeedDayStats()
    return getStreak(stats)
  }, [data])

  const weekStats = useMemo(() => {
    if (!data) return buildSeedDayStats()
    return data.dayStats.length >= 7 ? data.dayStats.slice(-7) : buildSeedDayStats()
  }, [data])

  const monthStats = useMemo(() => {
    if (!data) return []
    if (data.dayStats.length >= 30) return data.dayStats.slice(-30)
    return data.dayStats
  }, [data])

  const currentWord = useMemo(() => {
    if (!data || !selectedWord) return null
    return data.words.find((w) => w.word.toLowerCase() === selectedWord.toLowerCase()) || null
  }, [data, selectedWord])

  const filteredWords = useMemo(() => {
    if (!data) return []
    const list = todayWords.length ? todayWords : data.words
    if (wordFilter === 'all') return list
    if (wordFilter === 'weak') return list.filter((w) => w.weak || w.mastery === 'weak')
    if (wordFilter === 'focus') return list.filter((w) => w.focus)
    return list.filter((w) => w.type === wordFilter)
  }, [data, todayWords, wordFilter])

  const story = data?.stories.find((s) => s.date === todayKey()) || data?.stories[0]
  const review = data?.reviews.find((r) => r.date === todayKey()) || data?.reviews[0]
  const maimemoConnected = Boolean(data?.secrets.maimemoAccessToken || data?.settings.maimemo.connected)
  const maimemoUserLabel = data?.settings.maimemo.userLabel || userLabelOf(data?.secrets.maimemoUser)

  function openWord(word: string) {
    setSelectedWord(word)
    setTab('words')
  }

  async function withBusy(label: string, fn: () => Promise<void>) {
    if (!online) {
      setToast('当前无网络连接。')
      return
    }
    setBusy(label)
    try {
      await fn()
    } catch (e) {
      setToast(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusy(null)
    }
  }

  async function handleSync() {
    if (!data) return
    if (!isOnline()) {
      setToast('当前无网络连接。')
      return
    }
    await withBusy('正在同步墨墨…', async () => {
      const settings = data.settings
      if (settings.dataSource === 'sample') {
        const fresh = await resetToSampleData()
        setState(fresh)
        setToast('已切换到示例数据（演示模式）')
        return
      }
      if (!data.secrets.maimemoAccessToken) {
        setShowSettings(true)
        setToast('真实接入：请粘贴墨墨用户 Token 后同步')
        return
      }
      if (settings.dataSource === 'import' && !data.secrets.maimemoAccessToken) {
        setShowSettings(true)
        setToast('请在设置中导入今日单词，或填写 Token 同步')
        return
      }
      const bundle = await fetchMaimemoStudyBundle({
        baseUrl: settings.maimemo.baseUrl,
        accessToken: data.secrets.maimemoAccessToken,
      })
      if (!bundle.rawWords.length) {
        throw new Error(
          '今日学习单词为空。请确认今日已打开墨墨并学习/初始化，且 App 开启了自动同步。公测接口：POST .../memo/study/get_today_items',
        )
      }
      const incoming = normalizeSyncWords(bundle.rawWords, todayKey())
      // 用官方进度覆盖完成度（若有）
      let snapOverride: { finished?: number; total?: number } | null = null
      if (bundle.progress) snapOverride = bundle.progress

      const map = new Map(data.words.map((w) => [w.word.toLowerCase(), w]))
      for (const w of incoming) {
        const key = w.word.toLowerCase()
        const prev = map.get(key)
        map.set(
          key,
          prev
            ? {
                ...prev,
                ...w,
                id: prev.id,
                history: [...w.history, ...prev.history].slice(0, 20),
                ai: w.ai || prev.ai,
              }
            : w,
        )
      }
      const words = Array.from(map.values())
      await upsertWords(words)
      const localSnap = getTodayStats(words, settings.targetDaily)
      const todayNew = incoming.filter((w) => w.type === 'new').length
      const todayReview = incoming.filter((w) => w.type === 'review').length
      const snap = snapOverride
        ? {
            ...localSnap,
            newCount: todayNew,
            reviewCount: todayReview,
            totalCount: snapOverride.total ?? incoming.length,
            score: snapOverride.total
              ? Math.min(100, Math.round(((snapOverride.finished ?? 0) / snapOverride.total) * 100))
              : localSnap.score,
          }
        : localSnap
      await putSnapshot({ ...snap, id: snap.date })
      const nextSettings: AppSettings = {
        ...settings,
        dataSource: 'maimemo',
        lastSyncAt: new Date().toISOString(),
      }
      await persistSettings(nextSettings)
      const home = buildLocalHomeSummary(words)
      await putHomeSummary(home)
      const localReview = buildLocalReview({
        settings: nextSettings,
        words,
        dayStats: [],
        stories: data.stories,
        reviews: data.reviews,
        homeSummary: home,
        today: todayKey(),
      })
      await putReview(localReview)
      await reload()
      setToast(`同步完成，更新 ${incoming.length} 个词`)
    })
  }

  async function handleGenerateHomeAi() {
    if (!data) return
    await withBusy('生成今日总结…', async () => {
      const summary = await generateHomeSummary({ settings: { ...data.settings.mimo, apiKey: data.secrets.mimoApiKey }, words: data.words })
      await putHomeSummary(summary)
      await reload()
      setToast(summary.source === 'ai' ? 'AI 今日总结已生成' : '已用本地分析生成总结')
    })
  }

  async function handleGenerateStory() {
    if (!data) return
    await withBusy('生成故事中…', async () => {
      const nextStory = await generateStory({
        settings: { ...data.settings.mimo, apiKey: data.secrets.mimoApiKey },
        words: todayWords.length ? todayWords : data.words,
        mode: storyMode,
      })
      await putStory(nextStory)
      await reload()
      setToast('故事已更新')
    })
  }

  async function handleGenerateReview() {
    if (!data) return
    await withBusy('生成复盘…', async () => {
      const bundle = await generateReview({
        settings: { ...data.settings.mimo, apiKey: data.secrets.mimoApiKey },
        words: todayWords.length ? todayWords : data.words,
        allWords: data.words,
      })
      await putReview(bundle)
      await reload()
      setToast(bundle.source === 'ai' ? 'AI 复盘已生成' : '已生成本地复盘')
    })
  }

  async function handleGenerateWordAi(word: WordRecord) {
    if (!data) return
    await withBusy('生成单词精讲…', async () => {
      const ai = await generateWordAi({
        settings: { ...data.settings.mimo, apiKey: data.secrets.mimoApiKey },
        word,
      })
      const words = data.words.map((w) => (w.id === word.id ? { ...w, ai, updatedAt: new Date().toISOString() } : w))
      await upsertWords(words)
      await reload()
      setToast('单词内容已更新')
    })
  }

  function startQuiz() {
    if (!data) return
    const pool = todayWords.length ? todayWords : data.words
    const set = buildQuizSet(pool, 8)
    if (!set.length) {
      setToast('暂无可测单词，请先同步')
      return
    }
    setQuiz(set)
    setQuizIndex(0)
  }

  async function answerQuiz(option: string) {
    if (!quiz || !data) return
    const item = quiz[quizIndex]
    if (item.correct !== null) return
    const correct = option === item.meaning
    const answered: QuizRecord = { ...item, correct, answeredAt: new Date().toISOString() }
    const next = quiz.map((q, i) => (i === quizIndex ? answered : q))
    setQuiz(next)
    await putQuizRecord(answered)
  }

  function nextQuiz() {
    if (!quiz) return
    if (quizIndex < quiz.length - 1) setQuizIndex(quizIndex + 1)
    else {
      const score = quiz.filter((q) => q.correct === true).length
      setToast(`本轮完成：${score}/${quiz.length}`)
      setQuiz(null)
      reload()
    }
  }

  async function handleSaveMaimemoToken(token: string, baseUrl?: string) {
    if (!data) return
    const trimmed = token.trim()
    if (!trimmed) {
      setToast('请粘贴墨墨用户 Token')
      return
    }
    const secrets = {
      ...data.secrets,
      maimemoAccessToken: trimmed,
      maimemoUser: { name: '墨墨用户 Token' },
    }
    await persistSecrets(secrets)
    const settings: AppSettings = {
      ...data.settings,
      dataSource: 'maimemo',
      maimemo: {
        ...data.settings.maimemo,
        baseUrl: (baseUrl || data.settings.maimemo.baseUrl).trim() || data.settings.maimemo.baseUrl,
        accessToken: '',
        connected: true,
        userLabel: '墨墨用户 Token',
        accountId: data.settings.maimemo.accountId,
      },
    }
    await persistSettings(settings)
    await reload()
    setToast('墨墨 Token 已保存在本机，可点「同步学习数据」')
  }

  async function handleLoginMaimemo() {
    if (!isOnline()) {
      setToast('当前无网络连接。')
      return
    }
    const cfg = maimemoConfig()
    if (!cfg.clientId) {
      setToast('当前主路径是「粘贴用户 Token」。OIDC 需先配置 Client ID（可选）。')
      return
    }
    try {
      setBusy('跳转墨墨登录…')
      await beginMaimemoLogin()
    } catch (e) {
      setBusy(null)
      setToast(e instanceof Error ? e.message : '无法开始登录')
    }
  }

  async function handleLogoutMaimemo() {
    await clearMaimemoConnection()
    await reload()
    setToast('已断开墨墨连接（Token 已从本机清除）')
  }

  async function handleTestMaimemo() {
    if (!data) return
    if (!isOnline()) {
      setToast('当前无网络连接。')
      return
    }
    setBusy('测试墨墨 Token…')
    try {
      const token = data.secrets.maimemoAccessToken
      if (!token) {
        setToast('请先保存 Token')
        return
      }
      const result = await testMaimemoToken({
        baseUrl: data.settings.maimemo.baseUrl,
        accessToken: token,
      })
      setToast(result.message)
    } finally {
      setBusy(null)
    }
  }

  async function handleSaveMimoKey() {
    if (!data) return
    const secrets = { ...data.secrets, mimoApiKey: mimoKeyInput.trim() }
    await persistSecrets(secrets)
    const settings: AppSettings = {
      ...data.settings,
      mimo: { ...data.settings.mimo, apiKey: secrets.mimoApiKey },
    }
    await persistSettings(settings)
    await reload()
    setToast('MiMo API Key 已保存在本机')
  }

  async function handleTestMimo() {
    if (!data) return
    if (!isOnline()) {
      setToast('当前无网络连接。')
      return
    }
    setBusy('测试 MiMo 连接…')
    try {
      const result = await testMimoConnection({
        ...data.settings.mimo,
        apiKey: mimoKeyInput.trim() || data.secrets.mimoApiKey,
      })
      setToast(result.message)
    } finally {
      setBusy(null)
    }
  }

  async function handleImportJson() {
    if (!data) return
    try {
      const raw = parseImportPayload(importText)
      const words = normalizeSyncWords(raw, todayKey())
      if (!words.length) throw new Error('没有有效单词')
      const map = new Map(data.words.map((w) => [w.word.toLowerCase(), w]))
      for (const w of words) map.set(w.word.toLowerCase(), w)
      const merged = Array.from(map.values())
      await upsertWords(merged)
      const snap = getTodayStats(merged, data.settings.targetDaily)
      await putSnapshot({ ...snap, id: snap.date })
      const settings: AppSettings = { ...data.settings, dataSource: 'import' }
      await persistSettings(settings)
      await putHomeSummary(buildLocalHomeSummary(merged))
      setImportText('')
      await reload()
      setToast(`已导入 ${words.length} 个单词`)
    } catch (e) {
      setToast(e instanceof Error ? e.message : '导入失败')
    }
  }

  async function handleExportBackup() {
    const backup = await exportBackup()
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ciji-backup-${todayKey()}.json`
    a.click()
    URL.revokeObjectURL(url)
    setToast('已导出备份（不含 API Key / Token）')
  }

  async function handleImportBackupFile(file: File) {
    try {
      const text = await file.text()
      const json = JSON.parse(text) as BackupFile
      const next = await importBackup(json)
      setState(next)
      setToast('备份已导入')
    } catch (e) {
      setToast(e instanceof Error ? e.message : '备份导入失败')
    }
  }

  async function handleResetSample() {
    const next = await resetToSampleData()
    setState(next)
    setToast('已恢复示例数据')
  }

  if (!data || !todayStats) {
    return (
      <div className="app-shell">
        <header className="app-header">
          <div className="brand">
            <small>正在打开本地数据库</small>
            <h1>词迹</h1>
          </div>
        </header>
        <div className="card loading">加载中…</div>
        <Toast text={toast || busy} />
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <small>
            {formatMonthDay(todayKey())} · 今日词汇复盘
            {!online ? ' · 离线' : ''}
          </small>
          <h1>词迹</h1>
        </div>
        <button className="avatar" onClick={() => setShowSettings(true)} aria-label="设置">
          迹
        </button>
      </header>

      {!online && <Banner tone="warn">当前无网络连接。已同步的历史、故事、复盘与 Quiz 仍可查看。</Banner>}
      {oauthError && <Banner tone="warn">{oauthError}</Banner>}

      <main>
        {tab === 'home' && (
          <section className="home-grid">
            <div>
              <div className="hero">
                <div className="hero-top">
                  <div>
                    <h2>
                      {data.words.length === 0 && !maimemoConnected
                        ? '连接墨墨，开始真实学习复盘'
                        : todayStats.totalCount
                          ? '今天完成得不错'
                          : '今天还没有学习记录'}
                    </h2>
                    <p>
                      {data.words.length === 0 && !maimemoConnected
                        ? '本应用默认真实数据，不再使用 mock。设置里粘贴墨墨 Token → 同步。'
                        : '重点不是“背了多少”，而是找出哪些词正在反复遗忘。'}
                    </p>
                  </div>
                  <div className="score">{todayStats.score || '—'}</div>
                </div>
                <div className="stats">
                  <div className="stat">
                    <b>{todayStats.newCount}</b>
                    <span>今日新词</span>
                  </div>
                  <div className="stat">
                    <b>{todayStats.reviewCount}</b>
                    <span>今日复习</span>
                  </div>
                  <div className="stat">
                    <b>{todayStats.focusCount}</b>
                    <span>重点巩固</span>
                  </div>
                </div>
                <div className="progress-row">
                  <div className="progress-label">
                    <span>今日完成情况</span>
                    <span>
                      {todayStats.totalCount} / {data.settings.targetDaily}
                    </span>
                  </div>
                  <div className="progress-track">
                    <div
                      className="progress-fill"
                      style={{
                        width: `${Math.min(100, Math.round((todayStats.totalCount / Math.max(data.settings.targetDaily, 1)) * 100))}%`,
                      }}
                    />
                  </div>
                </div>
                <div className="meta-row" style={{ marginTop: 12 }}>
                  <span className="status">连续学习 {streak} 天</span>
                  <span className="status">
                    上次同步 {data.settings.lastSyncAt ? new Date(data.settings.lastSyncAt).toLocaleString() : '未同步'}
                  </span>
                  <span className="status">
                    <span className={`conn-dot ${maimemoConnected ? 'on' : ''}`} />
                    墨墨 {maimemoConnected ? '已连接' : '未连接'}
                  </span>
                </div>
              </div>

              <SectionTitle title="最值得再看一遍" action="查看全部" onAction={() => setTab('words')} />
              <div className="card focus-list">
                {focusWords.length ? (
                  focusWords.map((w) => (
                    <button className="focus" key={w.id} onClick={() => openWord(w.word)}>
                      <span className={`dot ${w.weak ? 'bad' : w.mastery === 'warn' ? 'warn' : 'good'}`} />
                      <div className="focus-main">
                        <b>{w.word}</b>
                        <span>{w.meaning}</span>
                      </div>
                      <span className="tag">{w.weak ? '再看一次' : '今日重点'}</span>
                    </button>
                  ))
                ) : (
                  <Empty>暂无重点词，先同步今日学习数据。</Empty>
                )}
              </div>
            </div>

            <div>
              <SectionTitle title="近 7 天学习量" action="详细数据" onAction={() => setTab('trends')} />
              <div className="card">
                <MiniChart
                  values={weekStats.map((s) => s.totalCount)}
                  labels={weekStats.map((s, i) =>
                    i === weekStats.length - 1 ? '今' : formatMonthDay(s.date).replace(/^\d+月/, ''),
                  )}
                />
              </div>

              <SectionTitle title="App 更新" />
              <UpdatePanel compact />

              <SectionTitle title="AI 今日总结" />
              <div className="card">
                <div className="insight">
                  <div className="icon">🧠</div>
                  <div>
                    <b>{data.homeSummary?.source === 'ai' ? 'MiMo 总结' : '学习观察'}</b>
                    <span>{data.homeSummary?.text || buildLocalHomeSummary(data.words).text}</span>
                  </div>
                </div>
                <div className="btn-row two">
                  <button className="primary-btn" onClick={() => setShowSettings(true)} disabled={!!busy}>
                    {maimemoConnected ? '墨墨设置' : '粘贴 Token'}
                  </button>
                  <button className="primary-btn" onClick={handleSync} disabled={!!busy}>
                    {busy === '正在同步墨墨…' || busy === '同步中…' ? busy : '同步墨墨'}
                  </button>
                </div>
                {!maimemoConnected && (
                  <div className="btn-row">
                    <button className="primary-btn" onClick={handleGenerateHomeAi} disabled={!!busy}>
                      {busy === '生成今日总结…' ? busy : '生成今日复盘'}
                    </button>
                  </div>
                )}
                {maimemoConnected && (
                  <div className="btn-row">
                    <button className="primary-btn" onClick={handleGenerateHomeAi} disabled={!!busy}>
                      {busy === '生成今日总结…' ? busy : '生成今日复盘'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {tab === 'words' && !currentWord && (
          <section>
            <SectionTitle
              title="今日单词"
              action={
                data.settings.dataSource === 'sample'
                  ? '示例数据'
                  : data.settings.dataSource === 'maimemo'
                    ? '墨墨'
                    : '导入'
              }
            />
            <div className="word-tools">
              {(
                [
                  ['all', `全部 ${todayWords.length || data.words.length}`],
                  ['new', '新词'],
                  ['review', '复习'],
                  ['weak', '薄弱词'],
                  ['focus', '重点词'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  className={`chip-btn ${wordFilter === key ? 'active' : ''}`}
                  onClick={() => setWordFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="words">
              {filteredWords.length ? (
                filteredWords.map((w) => (
                  <button className="word-card" key={w.id} onClick={() => setSelectedWord(w.word)}>
                    <div className="word-head">
                      <h4>{w.word}</h4>
                      <span className={`mastery ${masteryClass(w.mastery)}`}>{masteryLabel(w.mastery)}</span>
                    </div>
                    <div className="meaning">{w.meaning}</div>
                    <div className="meaning">
                      今日：{w.type === 'new' ? '新词' : '复习'} · 近期出现 {w.frequency} 次
                    </div>
                    {w.ai?.exampleEn ? <div className="example">{w.ai.exampleEn}</div> : null}
                  </button>
                ))
              ) : (
                <Empty>这里暂时没有单词。</Empty>
              )}
            </div>
          </section>
        )}

        {tab === 'words' && currentWord && (
          <section>
            <div className="back-bar">
              <button onClick={() => setSelectedWord(null)}>← 返回单词列表</button>
            </div>
            <div className="card">
              <h2 className="detail-title">{currentWord.word}</h2>
              {currentWord.phonetic ? <div className="phonetic">{currentWord.phonetic}</div> : null}
              <div className="meaning" style={{ fontSize: 15, color: 'var(--text)', marginTop: 10 }}>
                {currentWord.meaning}
              </div>
              <div className="kv">
                <div className="kv-item">
                  <span>今日状态</span>
                  <span>
                    {currentWord.type === 'new' ? '新词' : '复习'} · {masteryLabel(currentWord.mastery)}
                  </span>
                </div>
                <div className="kv-item">
                  <span>近期出现</span>
                  <span>{currentWord.frequency} 次</span>
                </div>
                <div className="kv-item">
                  <span>建议</span>
                  <span>
                    {currentWord.weak ? '需要强化' : currentWord.focus ? '重点巩固' : '保持复习'}
                  </span>
                </div>
              </div>
            </div>

            <SectionTitle title="AI 优秀例句" />
            <div className="card">
              <div className="example" style={{ borderTop: 0, paddingTop: 0, marginTop: 0 }}>
                {currentWord.ai?.exampleEn || `Students should learn how to use “${currentWord.word}” in real contexts.`}
              </div>
              {currentWord.ai?.exampleZh ? <div className="story-translation">{currentWord.ai.exampleZh}</div> : null}
              {currentWord.ai?.collocations?.length ? (
                <div style={{ marginTop: 12 }}>
                  <SectionTitle title="常见搭配" />
                  <div className="cover-words">
                    {currentWord.ai.collocations.map((c) => (
                      <span className="chip" key={c}>
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {currentWord.ai?.usage ? (
                <>
                  <SectionTitle title="用法说明" />
                  <p className="body-text" style={{ borderTop: 0, paddingTop: 0, color: 'var(--muted)' }}>
                    {currentWord.ai.usage}
                  </p>
                </>
              ) : null}
              {currentWord.ai?.confusables?.length ? (
                <>
                  <SectionTitle title="易混词" />
                  {currentWord.ai.confusables.map((c) => (
                    <div className="insight" key={c.word}>
                      <div className="icon">⚖️</div>
                      <div>
                        <b>
                          {currentWord.word} / {c.word}
                        </b>
                        <span>{c.note}</span>
                      </div>
                    </div>
                  ))}
                </>
              ) : null}
              {currentWord.ai?.cet4Value ? (
                <>
                  <SectionTitle title="CET-4 写作价值" />
                  <div className="insight">
                    <div className="icon">✍️</div>
                    <div>
                      <b>四级可用表达</b>
                      <span>{currentWord.ai.cet4Value}</span>
                    </div>
                  </div>
                </>
              ) : null}
              <button className="primary-btn" onClick={() => handleGenerateWordAi(currentWord)} disabled={!!busy}>
                {busy === '生成单词精讲…' ? busy : '生成/刷新 AI 精讲'}
              </button>
            </div>

            <SectionTitle title="历史学习记录" />
            <div className="card">
              {currentWord.history.length ? (
                currentWord.history.map((h, i) => (
                  <div className="kv-item" key={`${h.date}-${i}`}>
                    <span>{h.date}</span>
                    <span>
                      {h.type === 'new' ? '新词' : '复习'} ·{' '}
                      {h.result === 'remembered' ? '记得' : h.result === 'forgot' ? '遗忘' : '部分记得'}
                    </span>
                  </div>
                ))
              ) : (
                <Empty>暂无历史记录</Empty>
              )}
            </div>
          </section>
        )}

        {tab === 'story' && (
          <section>
            <SectionTitle title="AI 今日故事" action={story ? `${story.words.length} 个覆盖词` : '待生成'} />
            <div className="word-tools" style={{ marginBottom: 12 }}>
              {(
                [
                  ['daily', '日常故事'],
                  ['campus', '校园生活'],
                  ['cet4', 'CET-4 阅读'],
                  ['random', '随机主题'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  className={`chip-btn ${storyMode === key ? 'active' : ''}`}
                  onClick={() => setStoryMode(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="card">
              {story ? (
                <>
                  <div className="meta-row" style={{ marginBottom: 10 }}>
                    <span className="tag">{story.title}</span>
                    <span className="status">{story.mode}</span>
                  </div>
                  <div className="story">{highlightStory(story.en, story.words, openWord)}</div>
                  <div className="story-translation">{story.zh}</div>
                </>
              ) : (
                <Empty>还没有今日故事。同步单词后点击下方按钮生成。</Empty>
              )}
              <button className="primary-btn" onClick={handleGenerateStory} disabled={!!busy}>
                {busy === '生成故事中…' ? busy : story ? '换一个故事' : '生成今日故事'}
              </button>
              <p className="help" style={{ marginTop: 10 }}>
                高亮词来自今日/重点词库，点击可打开单词详情。已生成故事会写入本地，离线可回看。
              </p>
            </div>
            {story?.words?.length ? (
              <>
                <SectionTitle title="本篇覆盖词" />
                <div className="card">
                  <div className="cover-words">
                    {story.words.map((w) => (
                      <button className="chip" key={w} onClick={() => openWord(w)}>
                        {w}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : null}
          </section>
        )}

        {tab === 'review' && (
          <section>
            <SectionTitle title="AI 复盘" action={review?.source === 'ai' ? 'MiMo' : '本地分析'} />
            <div className="card">
              <div className="insight">
                <div className="icon">📋</div>
                <div>
                  <b>今日总结</b>
                  <span>{review?.summary || buildLocalReview(data).summary}</span>
                </div>
              </div>
              <div className="insight">
                <div className="icon">⭐</div>
                <div>
                  <b>最值得重看的单词</b>
                  <span>{(review?.topWords || []).join('、') || '暂无'}</span>
                </div>
              </div>
              {(review?.suggestions?.length ? review.suggestions : buildLocalReview(data).suggestions).map((s, i) => (
                <div className="insight" key={i}>
                  <div className="icon">💡</div>
                  <div>
                    <b>今日建议</b>
                    <span>{s}</span>
                  </div>
                </div>
              ))}
              <button className="primary-btn" onClick={handleGenerateReview} disabled={!!busy}>
                {busy === '生成复盘…' ? busy : '生成/刷新复盘'}
              </button>
            </div>

            <SectionTitle title="易混词组" />
            <div className="card">
              {(review?.confusables?.length ? review.confusables : buildLocalReview(data).confusables).length ? (
                (review?.confusables?.length ? review.confusables : buildLocalReview(data).confusables).map((g) => (
                  <div className="insight" key={g.title}>
                    <div className="icon">🔗</div>
                    <div>
                      <b>{g.title}</b>
                      <span>{g.note}</span>
                    </div>
                  </div>
                ))
              ) : (
                <Empty>今天数据里暂未识别到易混词组。</Empty>
              )}
            </div>
          </section>
        )}

        {tab === 'quiz' && (
          <section>
            <SectionTitle title="Quiz" action={quiz ? `${quizIndex + 1}/${quiz.length}` : '二次记忆'} />
            {!quiz && (
              <div className="card">
                <div className="insight">
                  <div className="icon">Q</div>
                  <div>
                    <b>根据今日/薄弱词出题</b>
                    <span>看释义选单词，巩固容易混淆的记忆痕迹。作答记录保存在本机 IndexedDB。</span>
                  </div>
                </div>
                {data.quizRecords.length > 0 && (
                  <div className="kv">
                    <div className="kv-item">
                      <span>历史作答</span>
                      <span>{data.quizRecords.length} 次</span>
                    </div>
                    <div className="kv-item">
                      <span>正确率</span>
                      <span>
                        {(() => {
                          const answered = data.quizRecords.filter((q) => q.correct !== null)
                          if (!answered.length) return '—'
                          const ok = answered.filter((q) => q.correct === true).length
                          return `${Math.round((ok / answered.length) * 100)}%`
                        })()}
                      </span>
                    </div>
                  </div>
                )}
                <button className="primary-btn" onClick={startQuiz}>
                  开始 Quiz
                </button>
              </div>
            )}
            {quiz && quiz[quizIndex] && (
              <div className="card">
                <div className="meta-row" style={{ marginBottom: 10 }}>
                  <span className="tag">{quiz[quizIndex].word}</span>
                  <span className="status">选择正确释义</span>
                </div>
                <div style={{ marginTop: 8 }}>
                  {quiz[quizIndex].options.map((opt) => {
                    const item = quiz[quizIndex]
                    const answered = item.correct !== null
                    let cls = 'quiz-option'
                    if (answered && opt === item.meaning) cls += ' correct'
                    else if (answered && opt !== item.meaning) cls += ' wrong'
                    return (
                      <button key={opt} className={cls} onClick={() => answerQuiz(opt)} disabled={answered}>
                        {opt}
                      </button>
                    )
                  })}
                </div>
                {quiz[quizIndex].correct !== null && (
                  <>
                    <p className="help" style={{ marginTop: 12 }}>
                      {quiz[quizIndex].correct ? '答对了。' : `再记一次：${quiz[quizIndex].meaning}`}
                    </p>
                    <button className="primary-btn" onClick={nextQuiz}>
                      {quizIndex < quiz.length - 1 ? '下一题' : '完成'}
                    </button>
                  </>
                )}
              </div>
            )}
          </section>
        )}

        {tab === 'trends' && (
          <section>
            <SectionTitle title="学习趋势" action={monthStats.length > 7 ? '近 30 天' : '近 7 天'} />
            <div className="card">
              <div className="row">
                <div>
                  <div className="trend-big">
                    {data.words.reduce((sum, w) => sum + w.frequency, 0).toLocaleString()}
                  </div>
                  <div className="help">累计接触词次（本地估算）</div>
                </div>
                <div className="delta">连续 {streak} 天</div>
              </div>
              <MiniChart
                values={(monthStats.length ? monthStats : weekStats).map((s) => s.totalCount)}
                labels={(monthStats.length ? monthStats : weekStats).map((s, i, arr) =>
                  i === arr.length - 1 ? '今' : formatMonthDay(s.date),
                )}
              />
            </div>
            <div className="summary-grid">
              <div className="card">
                <b>{data.words.filter((w) => w.type === 'new').length}</b>
                <span>库内新词</span>
              </div>
              <div className="card">
                <b>{data.words.filter((w) => w.weak).length}</b>
                <span>薄弱词</span>
              </div>
              <div className="card">
                <b>{data.words.filter((w) => w.frequency >= 3).length}</b>
                <span>反复出现</span>
              </div>
              <div className="card">
                <b>{streak}</b>
                <span>连续学习天数</span>
              </div>
            </div>
            <SectionTitle title="薄弱类型" />
            <div className="card">
              <div className="insight">
                <div className="icon">①</div>
                <div>
                  <b>动词边界不清</b>
                  <span>maintain / preserve / sustain 这类词更适合用语境对比，而不是只记中文。</span>
                </div>
              </div>
              <div className="insight">
                <div className="icon">②</div>
                <div>
                  <b>形容词“够不够”</b>
                  <span>adequate / sufficient 等词，先抓“达到基本要求”与“数量充足”的差别。</span>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>

      <BottomNav
        active={selectedWord && tab === 'words' ? 'words' : tab}
        onChange={(t) => {
          setTab(t)
          if (t !== 'words') setSelectedWord(null)
          if (t !== 'quiz') setQuiz(null)
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }}
      />

      {showSettings && (
        <SettingsSheet
          data={data}
          busy={busy}
          online={online}
          maimemoConnected={maimemoConnected}
          maimemoUserLabel={maimemoUserLabel}
          mimoKeyInput={mimoKeyInput}
          setMimoKeyInput={setMimoKeyInput}
          importText={importText}
          setImportText={setImportText}
          onClose={() => setShowSettings(false)}
          onLoginMaimemo={handleLoginMaimemo}
          onLogoutMaimemo={handleLogoutMaimemo}
          onSync={handleSync}
          maimemoTokenInput={maimemoTokenInput}
          setMaimemoTokenInput={setMaimemoTokenInput}
          onSaveMaimemoToken={handleSaveMaimemoToken}
          onTestMaimemo={handleTestMaimemo}
          showOidcAdvanced={showOidcAdvanced}
          setShowOidcAdvanced={setShowOidcAdvanced}
          onSaveMimoKey={handleSaveMimoKey}
          onTestMimo={handleTestMimo}
          onImportJson={handleImportJson}
          onExportBackup={handleExportBackup}
          onImportBackup={handleImportBackupFile}
          onResetSample={handleResetSample}
          onPersistSettings={async (next) => {
            await persistSettings(next)
            await reload()
            setToast('设置已保存')
          }}
        />
      )}

      <Toast text={toast || busy} />
    </div>
  )
}

function SettingsSheet(props: {
  data: AppState
  busy: string | null
  online: boolean
  maimemoConnected: boolean
  maimemoUserLabel: string
  maimemoTokenInput: string
  setMaimemoTokenInput: (v: string) => void
  onSaveMaimemoToken: (token: string, baseUrl?: string) => Promise<void>
  onTestMaimemo: () => void
  showOidcAdvanced: boolean
  setShowOidcAdvanced: (v: boolean) => void
  mimoKeyInput: string
  setMimoKeyInput: (v: string) => void
  importText: string
  setImportText: (v: string) => void
  onClose: () => void
  onLoginMaimemo: () => void
  onLogoutMaimemo: () => void
  onSync: () => void
  onSaveMimoKey: () => void
  onTestMimo: () => void
  onImportJson: () => void
  onExportBackup: () => void
  onImportBackup: (file: File) => void
  onResetSample: () => void
  onPersistSettings: (s: AppSettings) => Promise<void>
}) {
  const { data } = props
  const [dataSource, setDataSource] = useState(data.settings.dataSource)
  const [targetDaily, setTargetDaily] = useState(String(data.settings.targetDaily))
  const [maimemoBaseUrl, setMaimemoBaseUrl] = useState(data.settings.maimemo.baseUrl)
  const [mimoBaseUrl, setMimoBaseUrl] = useState(data.settings.mimo.baseUrl)
  const [mimoModel, setMimoModel] = useState(data.settings.mimo.model)
  const cfg = maimemoConfig()
  const tokenMasked = data.secrets.maimemoAccessToken
    ? `${data.secrets.maimemoAccessToken.slice(0, 6)}…${data.secrets.maimemoAccessToken.slice(-4)}`
    : ''

  return (
    <div className="modal show" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="sheet">
        <div className="row">
          <h3>设置</h3>
          <button className="secondary-btn" onClick={props.onClose}>
            关闭
          </button>
        </div>

        <SectionTitle title="墨墨账号" />
        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            <span className={`conn-dot ${props.maimemoConnected ? 'on' : ''}`} />
            {props.maimemoConnected ? '已连接' : '未连接'}
          </div>
          <div className="help" style={{ marginBottom: 10 }}>
            {props.maimemoConnected
              ? `用户：${props.maimemoUserLabel || '墨墨用户'}${tokenMasked ? ` · Token ${tokenMasked}` : ''}`
              : '主路径：粘贴墨墨用户 Token（App：我的 → 更多设置 → 实验功能 → 开放 API，或 open.maimemo.com/open/api/v1/tokens/openapi）。Token 仅保存在本机。'}
          </div>

          <div className="field">
            <label>用户 Token</label>
            <input
              type="password"
              value={props.maimemoTokenInput}
              onChange={(e) => props.setMaimemoTokenInput(e.target.value)}
              placeholder="粘贴你的墨墨用户 Token"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label>API Base URL（官方生产前缀）</label>
            <input
              value={maimemoBaseUrl}
              onChange={(e) => setMaimemoBaseUrl(e.target.value)}
              placeholder="https://open.maimemo.com/open"
            />
            <p className="help" style={{ marginTop: 6 }}>
              官方文档 https://open.maimemo.com/document#/ 。同步调用：
              <br />
              POST /api/v1/memo/study/get_today_items
              <br />
              POST /api/v1/memo/study/get_study_progress
              <br />
              Authorization: Bearer &lt;Token&gt;。公测接口，需墨墨 App 开启自动同步。
            </p>
          </div>

          <div className="btn-row two">
            <button
              className="primary-btn"
              onClick={async () => {
                await props.onSaveMaimemoToken(props.maimemoTokenInput, maimemoBaseUrl)
                props.setMaimemoTokenInput('')
              }}
              disabled={!!props.busy}
            >
              保存 Token
            </button>
            <button className="primary-btn" onClick={props.onTestMaimemo} disabled={!!props.busy || !props.online || !props.maimemoConnected}>
              测试 Token
            </button>
          </div>
          <div className="btn-row">
            {props.maimemoConnected ? (
              <button className="primary-btn" onClick={props.onSync} disabled={!!props.busy || !props.online}>
                同步学习数据
              </button>
            ) : (
              <button className="primary-btn" onClick={props.onSync}>
                使用当前数据
              </button>
            )}
          </div>
          {props.maimemoConnected && (
            <button className="danger-btn" onClick={props.onLogoutMaimemo}>
              退出连接（清除本机 Token）
            </button>
          )}

          <div style={{ marginTop: 12 }}>
            <button
              className="secondary-btn"
              type="button"
              onClick={() => props.setShowOidcAdvanced(!props.showOidcAdvanced)}
            >
              {props.showOidcAdvanced ? '收起 OIDC 高级选项' : '高级：OIDC PKCE（可选）'}
            </button>
          </div>
          {props.showOidcAdvanced && (
            <div style={{ marginTop: 10 }}>
              <p className="help">
                若你已在墨墨开放平台申请了纯前端应用，可尝试 OIDC 登录。当前产品主路径是用户 Token。
                <br />
                Issuer：{cfg.issuer}
                <br />
                Callback：{cfg.redirectUri}
                <br />
                Client ID：{cfg.clientId ? `${cfg.clientId.slice(0, 8)}…` : '未配置（无需也可）'}
              </p>
              <button className="secondary-btn" onClick={props.onLoginMaimemo} disabled={!props.online || !cfg.clientId}>
                尝试 OIDC 登录墨墨
              </button>
            </div>
          )}
        </div>

        <SectionTitle title="数据源" />
        <div className="field">
          <label>当前模式</label>
          <select value={dataSource} onChange={(e) => setDataSource(e.target.value as AppSettings['dataSource'])}>
            <option value="maimemo">墨墨真实数据（Token）</option>
            <option value="import">本地 JSON 导入</option>
            <option value="sample">示例数据（仅演示）</option>
          </select>
        </div>
        <div className="field">
          <label>墨墨 API Base URL</label>
          <input value={maimemoBaseUrl} onChange={(e) => setMaimemoBaseUrl(e.target.value)} />
        </div>
        <div className="field">
          <label>每日目标词次</label>
          <input type="number" value={targetDaily} onChange={(e) => setTargetDaily(e.target.value)} />
        </div>
        <button
          className="secondary-btn"
          onClick={() =>
            props.onPersistSettings({
              ...data.settings,
              dataSource,
              targetDaily: Number(targetDaily) || 120,
              maimemo: { ...data.settings.maimemo, baseUrl: maimemoBaseUrl },
            })
          }
        >
          保存数据源设置
        </button>

        <SectionTitle title="MiMo API" />
        <div className="card">
          <Banner tone="info">
            安全模型：MiMo Key 不会出现在公网前端。
            推荐：Cloudflare Worker Secret + 设置里的中继地址；或仅在本设备设置中保存 Key（IndexedDB）。
            墨墨 Token 同样只存本机，不进仓库。
          </Banner>
          <div className="field">
            <label>Base URL</label>
            <input value={mimoBaseUrl} onChange={(e) => setMimoBaseUrl(e.target.value)} />
          </div>
          <div className="field">
            <label>模型</label>
            <input value={mimoModel} onChange={(e) => setMimoModel(e.target.value)} />
          </div>
          <div className="field">
            <label>API Key</label>
            <input
              type="password"
              value={props.mimoKeyInput}
              onChange={(e) => props.setMimoKeyInput(e.target.value)}
              placeholder="仅保存在本机"
              autoComplete="off"
            />
          </div>
          <div className="btn-row two">
            <button
              className="primary-btn"
              onClick={async () => {
                await props.onPersistSettings({
                  ...data.settings,
                  mimo: { baseUrl: mimoBaseUrl, model: mimoModel, apiKey: props.mimoKeyInput.trim() },
                })
                await props.onSaveMimoKey()
              }}
            >
              保存 Key
            </button>
            <button className="primary-btn" onClick={props.onTestMimo} disabled={!!props.busy || !props.online}>
              测试连接
            </button>
          </div>
          <p className="help" style={{ marginTop: 8 }}>
            浏览器直连已检测到 MiMo 返回 CORS `Access-Control-Allow-Origin: *`，默认无需代理。
            若你的网络仍失败，可部署 `cloudflare/worker.js` 并配置 VITE_AI_RELAY_URL。
          </p>
        </div>

        <SectionTitle title="导入今日单词 JSON" />
        <div className="field">
          <textarea
            value={props.importText}
            onChange={(e) => props.setImportText(e.target.value)}
            placeholder='{"words":[{"word":"maintain","meaning":"v. 维持","type":"review","mastery":"weak","frequency":4}]}'
          />
        </div>
        <button className="primary-btn" onClick={props.onImportJson}>
          导入 JSON
        </button>

        <SectionTitle title="关于与更新" />
        <UpdatePanel />

        <SectionTitle title="数据管理" />
        <div className="card">
          <p className="help" style={{ marginTop: 0 }}>
            导出内容包含学习历史、AI 内容、Quiz、设置；<strong>不包含</strong> MiMo API Key、墨墨 Token、OAuth 临时数据。
          </p>
          <div className="btn-row two">
            <button className="primary-btn" onClick={props.onExportBackup}>
              导出全部数据
            </button>
            <label className="primary-btn" style={{ display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
              导入备份
              <input
                type="file"
                accept="application/json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) props.onImportBackup(f)
                  e.target.value = ''
                }}
              />
            </label>
          </div>
          <button className="danger-btn" onClick={props.onResetSample}>
            仅演示用：载入示例数据
          </button>
        </div>

        <SectionTitle title="PWA" />
        <div className="card">
          <p className="help" style={{ marginTop: 0 }}>
            手机浏览器打开本站 → 菜单 →「添加到主屏幕」，即可作为独立 App 使用。
            Service Worker 会缓存应用壳与静态资源；离线时可查看已保存的历史与 AI 内容。
          </p>
        </div>
      </div>
    </div>
  )
}
