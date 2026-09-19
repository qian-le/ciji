import type { ReactNode } from 'react'
import type { TabKey } from './types'

const tabs: { key: TabKey; label: string; ico: string }[] = [
  { key: 'home', label: '今日', ico: '⌂' },
  { key: 'words', label: '单词', ico: 'Aa' },
  { key: 'story', label: '故事', ico: '✦' },
  { key: 'review', label: '复盘', ico: '◎' },
  { key: 'quiz', label: 'Quiz', ico: 'Q' },
  { key: 'trends', label: '数据', ico: '▥' },
]

export function BottomNav({ active, onChange }: { active: TabKey; onChange: (t: TabKey) => void }) {
  return (
    <nav className="bottom-nav" aria-label="主导航">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          className={`nav-btn ${active === tab.key ? 'active' : ''}`}
          onClick={() => onChange(tab.key)}
        >
          <span className="ico">{tab.ico}</span>
          {tab.label}
        </button>
      ))}
    </nav>
  )
}

export function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="section-title">
      <h3>{title}</h3>
      {action ? (
        <button type="button" onClick={onAction}>
          {action}
        </button>
      ) : null}
    </div>
  )
}

export function MiniChart({ values, labels }: { values: number[]; labels: string[] }) {
  const max = Math.max(...values, 1)
  return (
    <div className="mini-chart">
      {values.map((v, i) => (
        <div className="bar-wrap" key={`${labels[i]}-${i}`}>
          <div
            className={`bar ${i === values.length - 1 ? 'today' : ''}`}
            style={{ height: `${Math.max(16, Math.round((v / max) * 88))}px` }}
          />
          <span>{labels[i]}</span>
        </div>
      ))}
    </div>
  )
}

export function Toast({ text }: { text: string | null }) {
  if (!text) return null
  return <div className="toast">{text}</div>
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty-note">{children}</div>
}

export function Banner({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  return <div className={`banner banner-${tone}`}>{children}</div>
}
