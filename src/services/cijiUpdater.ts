import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export interface NativeBuildInfo {
  versionCode: number
  versionName: string
  packageName: string
}

export interface NativeDownloadProgress {
  received: number
  total: number
  percent: number
}

export interface CijiUpdaterPlugin {
  getBuildInfo(): Promise<NativeBuildInfo>
  /** 下载 APK 到应用私有目录，返回本地 file path */
  downloadApk(options: { url: string; fileName?: string }): Promise<{ path: string; size: number }>
  /** 拉起系统安装界面 */
  installApk(options: { path: string }): Promise<{ started: boolean }>
  /** 取消进行中的下载 */
  cancelDownload(): Promise<void>
  addListener(
    eventName: 'downloadProgress',
    listenerFunc: (progress: NativeDownloadProgress) => void,
  ): Promise<PluginListenerHandle>
}

export const CijiUpdater = registerPlugin<CijiUpdaterPlugin>('CijiUpdater')

/** 浏览器/预览环境下的降级实现：无法安装 APK */
export const fallbackBuildInfo: NativeBuildInfo = {
  versionCode: Number(import.meta.env.VITE_FALLBACK_VERSION_CODE || 2),
  versionName: String(import.meta.env.VITE_FALLBACK_VERSION_NAME || '1.1.0'),
  packageName: 'com.ciji.wordtrail',
}

export async function getBuildInfoSafe(): Promise<NativeBuildInfo & { native: boolean }> {
  try {
    const info = await CijiUpdater.getBuildInfo()
    return { ...info, native: true }
  } catch {
    return { ...fallbackBuildInfo, native: false }
  }
}
