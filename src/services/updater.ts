export type UpdateChannel = 'github-release' | 'update-json'

export interface LocalBuildInfo {
  versionCode: number
  versionName: string
  packageName: string
  platform?: string
}

export interface UpdateInfo {
  versionCode: number
  versionName: string
  apkUrl: string
  changelog: string[]
  force: boolean
  htmlUrl?: string
  source: UpdateChannel
}

export interface DownloadProgress {
  received: number
  total: number
  percent: number
}

/** 仓库公开 raw / API 源（无需 token） */
export const UPDATE_OWNER = 'qian-le'
export const UPDATE_REPO = 'ciji'

export function updateJsonUrl(owner = UPDATE_OWNER, repo = UPDATE_REPO): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/main/update.json`
}

export function latestReleaseApiUrl(owner = UPDATE_OWNER, repo = UPDATE_REPO): string {
  return `https://api.github.com/repos/${owner}/${repo}/releases/latest`
}

/** 判断是否需要更新：只用 versionCode 数值比较 */
export function needsUpdate(currentVersionCode: number, remoteVersionCode: number): boolean {
  return Number(remoteVersionCode) > Number(currentVersionCode)
}

export function parseChangelog(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*•]\s*/, '').trim())
    .filter((line) => line && !/^versionCode\s*:/i.test(line) && !/^versionName\s*:/i.test(line))
}

export function extractVersionCodeFromRelease(body: string, tag: string, assets: { name: string }[]): number | null {
  const fromBody = body.match(/versionCode\s*[:=]\s*(\d+)/i)
  if (fromBody) return Number(fromBody[1])
  const fromTag = tag.match(/(\d+)\s*$/)
  // tag 仅作展示，不作为唯一依据；优先 body
  if (fromTag && Number.isFinite(Number(fromTag[1]))) {
    // 不把 v1.1.0 的 0 当 versionCode
  }
  const apk = assets.find((a) => a.name.endsWith('.apk'))
  if (apk) {
    const m = apk.name.match(/versionCode[-_](\d+)/i)
    if (m) return Number(m[1])
  }
  return fromTag && tag.startsWith('vc-') ? Number(fromTag[1]) : null
}

export function pickApkUrl(assets: { name: string; browser_download_url: string }[]): string | null {
  const preferred = assets.find((a) => /ciji-.*\.apk$/i.test(a.name) || /\.apk$/i.test(a.name))
  return preferred?.browser_download_url || null
}

export async function fetchUpdateJson(url = updateJsonUrl()): Promise<UpdateInfo | null> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 12000)
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: ac.signal })
    if (!res.ok) return null
    const data = (await res.json()) as {
      versionCode?: number
      versionName?: string
      apkUrl?: string
      changelog?: string[] | string
      force?: boolean
    }
    if (!data.versionCode || !data.apkUrl) return null
    const changelog = Array.isArray(data.changelog)
      ? data.changelog.slice(0, 20)
      : String(data.changelog || '')
          .split(/\r?\n/)
          .filter(Boolean)
          .slice(0, 20)
    return {
      versionCode: Number(data.versionCode),
      versionName: String(data.versionName || data.versionCode),
      apkUrl: data.apkUrl,
      changelog,
      force: Boolean(data.force),
      source: 'update-json',
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchUpdateFromGitHubRelease(
  owner = UPDATE_OWNER,
  repo = UPDATE_REPO,
): Promise<UpdateInfo | null> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 12000)
  try {
    const res = await fetch(latestReleaseApiUrl(owner, repo), {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
      signal: ac.signal,
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      tag_name?: string
      body?: string
      html_url?: string
      assets?: { name: string; browser_download_url: string }[]
      draft?: boolean
      prerelease?: boolean
    }
    if (data.draft) return null
    const assets = data.assets || []
    const apkUrl = pickApkUrl(assets)
    if (!apkUrl) return null
    const body = data.body || ''
    const versionCode = extractVersionCodeFromRelease(body, data.tag_name || '', assets)
    const updateAsset = assets.find((a) => a.name === 'update.json')
    if (updateAsset) {
      try {
        const u = await fetchUpdateJson(updateAsset.browser_download_url)
        if (u) return { ...u, htmlUrl: data.html_url, source: 'github-release' }
      } catch {
        /* fallthrough */
      }
    }
    if (!versionCode) return null
    return {
      versionCode,
      versionName: (data.tag_name || '').replace(/^v/i, '') || String(versionCode),
      apkUrl,
      changelog: parseChangelog(body),
      force: /force\s*:\s*true/i.test(body),
      htmlUrl: data.html_url,
      source: 'github-release',
    }
  } finally {
    clearTimeout(timer)
  }
}

/** 优先 update.json，失败再用 GitHub Releases API */
export async function checkForUpdate(currentVersionCode: number): Promise<UpdateInfo | null> {
  let info: UpdateInfo | null = null
  try {
    info = await fetchUpdateJson()
  } catch {
    info = null
  }
  if (!info) {
    try {
      info = await fetchUpdateFromGitHubRelease()
    } catch {
      info = null
    }
  }
  if (!info) return null
  if (!needsUpdate(currentVersionCode, info.versionCode)) return null
  return info
}
