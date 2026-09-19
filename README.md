# 词迹（Ciji）Android App + GitHub Releases 在线更新

墨墨负责记忆调度，词迹负责背完后的分析、语境与二次记忆。

**最终形态：Android App（Capacitor）**，通过 **GitHub Actions 自动签名发布 + App 内覆盖更新**。

不再以 GitHub Pages 作为主交付路径（Pages 仅可选手动触发）。

---

## 在线更新体验

```text
打开词迹 → 后台检查 GitHub Releases / update.json
→ 发现 versionCode 更大 → 弹出更新
→ 立即更新 → 下载 APK → 系统安装确认 → 覆盖升级
```

- 升级判断：**只用 `versionCode` 数值比较**
- `versionName` 仅展示
- 包名始终 `com.ciji.wordtrail`
- **同一 Signing Key** 才能覆盖安装
- MiMo Key / 墨墨 Token / IndexedDB 学习数据：**更新后保留**（不打包进 APK）

设置页：`关于词迹 → 当前版本 / 更新状态 / 检查更新`。

---

## 开发发布流程

```text
修改 version.json（versionCode +1，versionName 与 changelog）
↓
git push main
↓
GitHub Actions: 构建 Web → Capacitor Android → 签名 APK
↓
创建 Release vX.Y.Z 并上传 APK + update.json
↓
App 内检查更新 → 下载安装
```

### 修改版本

编辑 `version.json`：

```json
{
  "versionCode": 3,
  "versionName": "1.2.0",
  "changelog": ["新增...", "修复..."]
}
```

本地可执行：`npm run release:prepare`（同步 package.json / gradle / update.json）。

---

## 签名（极重要）

| 项 | 路径 / 名称 |
|----|-------------|
| Keystore | `android/keystore/ciji-release.jks`（**gitignore**） |
| Alias | `ciji` |
| properties | `android/keystore/keystore.properties`（**gitignore**） |
| Base64 | `android/keystore/ciji-release.jks.base64.txt`（**gitignore**） |

初始化：`npm run keystore:init`（或 `powershell -File scripts/init-keystore.ps1`）。

### GitHub Secrets（Actions 用）

| Secret | 来源 |
|--------|------|
| `ANDROID_KEYSTORE_BASE64` | `ciji-release.jks.base64.txt` 全文 |
| `ANDROID_KEYSTORE_ALIAS` | `ciji` |
| `ANDROID_KEYSTORE_PASSWORD` | props 中 `storePassword` |
| `ANDROID_KEY_PASSWORD` | props 中 `keyPassword` |

设置示例：

```powershell
Get-Content android\keystore\ciji-release.jks.base64.txt | gh secret set ANDROID_KEYSTORE_BASE64 --repo qian-le/ciji
(Get-Content android\keystore\keystore.properties | ? {$_ -like 'storePassword=*'}) -replace 'storePassword=','' | gh secret set ANDROID_KEYSTORE_PASSWORD --repo qian-le/ciji
# keyAlias / keyPassword 同理
```

> **Signing Key 一旦丢失，已安装的词迹将无法再被同包名新版覆盖升级。请把整个 `android/keystore/` 离线备份（U盘/私有网盘），不要只放在本机。**

---

## 本地构建

```powershell
cd D:\ciji
npm ci
npm run android:sync
# 调试包
cd android
$env:JAVA_HOME="D:\java\jdk-21"
$env:ANDROID_HOME="D:\Android\Sdk"
.\gradlew assembleDebug
# 发布包（需本地 keystore.properties）
.\gradlew assembleRelease
```

产物：

- Debug: `android/app/build/outputs/apk/debug/app-debug.apk`
- Release: `android/app/build/outputs/apk/release/app-release.apk`

---

## 更新源

1. **优先**：`update.json`  
   `https://raw.githubusercontent.com/qian-le/ciji/main/update.json`
2. **回退**：GitHub Releases API `.../releases/latest`（资产中的 APK + `update.json`）

`version.json` → Actions 发布时写入 Release 与 `update.json` 的 `apkUrl`。

---

## 安全

- MiMo API Key：**不写入 APK**，设置页填写，存本机
- 墨墨用户 Token：本机
- Keystore / 密码：仅 Secrets + 本地 gitignore 目录
- 公开 Pages 不再注入 `VITE_MIMO_API_KEY`
- 详见 `docs/SECURITY.md`

---

## 目录

| 路径 | 说明 |
|------|------|
| `D:\ciji` | 主工程 |
| `version.json` | 版本唯一来源（versionCode/Name/changelog） |
| `update.json` | App 检查源（发布后由 Actions 更新） |
| `src/services/updater.ts` | 版本检查逻辑 |
| `src/services/cijiUpdater.ts` | 原生下载/安装插件封装 |
| `src/components/UpdatePanel.tsx` | 关于与更新 UI |
| `android/.../CijiUpdaterPlugin.java` | DownloadManager + PackageInstaller |
| `.github/workflows/android-release.yml` | 自动签名发布 |

---

## 更新器行为

- 启动约 2.5s 后后台检查一次（不阻塞首屏）
- 设置页可手动「检查更新」
- 支持下载进度、取消、失败重试
- 点击「立即更新」下载 APK 后调用系统安装界面
- 用户可在系统层取消安装
