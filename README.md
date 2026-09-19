# 词迹（Ciji）PWA

墨墨背单词负责「记忆调度」，词迹负责「背完之后的分析、语境与二次记忆」。

**形态**：Web App + PWA + GitHub Pages（不再维护 Android APK / Capacitor / Gradle）

## 功能

- 今日学习（新词/复习/完成度/连续天数/重点词）
- 今日单词列表 + 单词详情（AI 例句、搭配、用法、易混、四级价值）
- AI 今日故事（多模式，高亮词可点进详情）
- AI 复盘（总结、最值得重看、易混词、建议）
- Quiz 二次记忆
- 7 日 / 30 日趋势与薄弱分析
- 设置：墨墨 OIDC 登录、MiMo API Key（本机）、JSON 导入、数据备份

## 技术

- Vite + React + TypeScript
- PWA：`vite-plugin-pwa`（App Shell 离线缓存）
- 本地数据：IndexedDB（Dexie）
- 路由：Hash（`#/auth/callback`），兼容 GitHub Pages 子路径
- 构建 `base: './'`

## 本地开发

```powershell
cd D:\ciji
npm ci
npm run dev
```

构建：

```powershell
npm run build
npm run preview
```

## 部署 GitHub Pages（最少步骤）

1. 在 GitHub 新建仓库，建议名为 **`ciji`**（公开即可）。
2. 把本目录推上去（**不要**提交 `.env`）：

```powershell
cd D:\ciji
git init
git add .
git commit -m "ciji pwa"
git branch -M main
git remote add origin https://github.com/<username>/ciji.git
git push -u origin main
```

3. 仓库 **Settings → Pages**：Source 选 **GitHub Actions**。
4. 仓库 **Settings → Secrets and variables → Actions**：
   - **Secrets** 增加：`VITE_MAIMEMO_CLIENT_ID`（墨墨开放平台的 client_id，可公开，但用 Secret 管理更省事）
   - **Variables**（可选）：
     - `VITE_MAIMEMO_ISSUER` = `https://accounts.maimemo.com/oidc`
     - `VITE_MAIMEMO_SCOPE` = `openid profile`
     - `VITE_MAIMEMO_REDIRECT_URI` = `https://<username>.github.io/ciji/auth/callback`
     - `VITE_AI_RELAY_URL` = （仅当需要 Worker 时）
5. 推送到 `main` 后，Actions 会自动 `npm ci && npm run build` 并发布 Pages。
6. 打开：`https://<username>.github.io/ciji/`
7. 手机浏览器 → 菜单 → **添加到主屏幕**。

### 墨墨开放平台填写

| 项 | 值 |
|----|-----|
| 主页 | `https://<username>.github.io/ciji/` |
| Redirect URI | `https://<username>.github.io/ciji/auth/callback` |
| 应用类型 | 纯前端 / SPA（Authorization Code + **PKCE**） |
| client_secret | **不要**填进本仓库或前端代码 |

本地开发回调：`http://localhost:5173/auth/callback`（若开放平台允许 localhost）。

本地环境变量见 `.env.example`，复制为 `.env` 后填写 `VITE_MAIMEMO_CLIENT_ID`。

## MiMo API

- 默认 `https://api.xiaomimimo.com/v1` + `mimo-v2.5`
- **不要**把 API Key 写进源码或 `.env` 提交 GitHub
- 在 App「设置 → MiMo API」中填写，Key **仅保存在本机 IndexedDB**
- 设置页提供「测试连接」
- **CORS 实测（2026-09）**：`api.xiaomimimo.com` 返回 `Access-Control-Allow-Origin: *`，浏览器可直连
- 若你的网络仍失败：部署 `cloudflare/worker.js`，`wrangler secret put MIMO_API_KEY`，并设置 `VITE_AI_RELAY_URL`

## 数据与备份

本地 IndexedDB 表：

- `words`
- `wordLearningRecords`
- `dailyLearning`
- `dailySnapshots`
- `aiDailyPackages`
- `quizRecords`
- `settings`（含本机 secrets，导出时剥离）

设置 → 数据管理：

- **导出全部数据** → `ciji-backup-YYYY-MM-DD.json`
- **导入备份**
- 导出**不含** MiMo API Key、墨墨 Access/Refresh Token、OAuth 临时数据

## 安全检查清单

- [x] `.gitignore` 忽略 `.env`、密钥、keystore、APK
- [x] 源码中无硬编码 API Key / client_secret
- [x] Access Token 仅存 IndexedDB，不进 Git
- [x] 备份导出剥离 secrets
- [ ] 你自己的 GitHub Secrets 只放 `VITE_MAIMEMO_CLIENT_ID` 等配置，不放 MiMo Key

## 项目路径

| 项 | 路径 |
|----|------|
| 源码（请用此路径建 git） | `D:\ciji` |
| 本地预览产物 | `dist/` |
| 历史 Android 镜像（已停更） | `D:\词迹` |

## 离线行为

- App Shell / JS / CSS / 图标由 Service Worker 缓存
- 已同步单词、故事、复盘、Quiz 历史、趋势可离线查看
- 离线点击「同步墨墨 / 生成 AI」→ 提示 **当前无网络连接。**
