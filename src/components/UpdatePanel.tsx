import { useCallback, useEffect, useRef, useState } from 'react'
import { Banner } from '../components'
import { CijiUpdater, getBuildInfoSafe } from '../services/cijiUpdater'
import {
  checkForUpdate,
  type DownloadProgress,
  type LocalBuildInfo,
  type UpdateInfo,
} from '../services/updater'

type UpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'latest' | 'error'

export function UpdatePanel({ compact = false }: { compact?: boolean }) {
  const [build, setBuild] = useState<(LocalBuildInfo & { native: boolean }) | null>(null)
  const [phase, setPhase] = useState<UpdatePhase>('idle')
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState('')
  const [apkPath, setApkPath] = useState<string | null>(null)
  const listenerRef = useRef<{ remove: () => Promise<void> } | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const info = await getBuildInfoSafe()
      if (!cancelled) setBuild(info)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        const handle = await CijiUpdater.addListener('downloadProgress', (p: DownloadProgress) => {
          setProgress(p.percent || 0)
        })
        listenerRef.current = handle
      } catch {
        /* browser preview */
      }
    })()
    return () => {
      listenerRef.current?.remove?.().catch(() => {})
    }
  }, [])

  const runCheck = useCallback(async (silent = false) => {
    if (!build) return null
    if (!silent) {
      setPhase('checking')
      setMessage('正在检查更新…')
    }
    try {
      const info = await checkForUpdate(build.versionCode)
      if (!info) {
        setPhase('latest')
        setUpdate(null)
        setMessage('已是最新版本')
        return null
      }
      setUpdate(info)
      setPhase('available')
      setMessage(`发现新版本 v${info.versionName}`)
      return info
    } catch (e) {
      setPhase('error')
      setMessage(e instanceof Error ? e.message : '检查更新失败')
      return null
    }
  }, [build])

  // 启动后台轻量检查
  useEffect(() => {
    if (!build?.native) return
    const t = setTimeout(() => {
      runCheck(true).catch(() => {})
    }, 2500)
    return () => clearTimeout(t)
  }, [build?.native, runCheck])

  const startUpdate = useCallback(async () => {
    if (!update || !build?.native) {
      setMessage('当前环境无法安装 APK，请在 Android 真机上使用。')
      setPhase('error')
      return
    }
    setPhase('downloading')
    setProgress(0)
    setMessage('正在下载安装包…')
    try {
      const file = `ciji-v${update.versionName}-vc${update.versionCode}.apk`
      const res = await CijiUpdater.downloadApk({ url: update.apkUrl, fileName: file })
      setApkPath(res.path)
      setPhase('ready')
      setMessage('下载完成，正在拉起系统安装…')
      await CijiUpdater.installApk({ path: res.path })
    } catch (e) {
      setPhase('error')
      setMessage(e instanceof Error ? e.message : '下载失败，可点“重试下载”')
    }
  }, [update, build])

  const retry = useCallback(() => {
    if (update) startUpdate()
    else runCheck()
  }, [update, startUpdate, runCheck])

  if (compact) {
    return (
      <div className="meta-row">
        <span className="status">
          v{build?.versionName || '—'} · code {build?.versionCode ?? '—'}
        </span>
        {phase === 'available' && update ? (
          <button className="secondary-btn" onClick={startUpdate}>
            更新到 v{update.versionName}
          </button>
        ) : null}
        {phase !== 'available' ? (
          <button className="secondary-btn" onClick={() => runCheck()}>
            检查更新
          </button>
        ) : null}
        {message ? <span className="status">{message}</span> : null}
      </div>
    )
  }

  return (
    <div className="card">
      <div style={{ fontWeight: 700, marginBottom: 8 }}>关于词迹</div>
      <div className="kv">
        <div className="kv-item">
          <span>当前版本</span>
          <span>
            v{build?.versionName || '—'}（versionCode {build?.versionCode ?? '—'}）
          </span>
        </div>
        <div className="kv-item">
          <span>包名</span>
          <span>{build?.packageName || 'com.ciji.wordtrail'}</span>
        </div>
        <div className="kv-item">
          <span>更新状态</span>
          <span>
            {phase === 'checking' && '检查中…'}
            {phase === 'latest' && '已是最新版本'}
            {phase === 'available' && `发现 v${update?.versionName}`}
            {phase === 'downloading' && `下载中 ${progress}%`}
            {phase === 'ready' && '已下载，等待系统安装'}
            {phase === 'error' && message}
            {phase === 'idle' && (message || '未检查')}
          </span>
        </div>
      </div>

      {phase === 'available' && update ? (
        <div style={{ marginTop: 12 }}>
          <Banner tone="info">
            发现新版本 v{update.versionName}（versionCode {update.versionCode}）
            {update.changelog.length ? (
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {update.changelog.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}
          </Banner>
          <div className="btn-row two">
            <button className="secondary-btn" onClick={() => setPhase('latest')}>
              稍后更新
            </button>
            <button className="primary-btn" onClick={startUpdate} disabled={!build?.native}>
              立即更新
            </button>
          </div>
        </div>
      ) : null}

      {phase === 'downloading' ? (
        <div style={{ marginTop: 12 }}>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="help" style={{ marginTop: 6 }}>
            下载进度 {progress}%
          </div>
          <button className="secondary-btn" onClick={() => CijiUpdater.cancelDownload().catch(() => {})}>
            取消下载
          </button>
        </div>
      ) : null}

      {phase === 'error' ? (
        <div className="btn-row two">
          <button className="primary-btn" onClick={retry}>
            重试下载 / 检查
          </button>
        </div>
      ) : null}

      {apkPath ? <div className="help">安装包：{apkPath}</div> : null}

      <div className="btn-row">
        <button className="primary-btn" onClick={() => runCheck()} disabled={phase === 'checking' || phase === 'downloading'}>
          检查更新
        </button>
      </div>
      <p className="help" style={{ marginTop: 8 }}>
        更新源：GitHub Releases / update.json。升级覆盖安装不会清空学习数据与本机 API Key。
        versionCode 仅数值比较，不使用字符串版本号判断。
      </p>
    </div>
  )
}
