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
4. **Settings → Secrets and variables → Actions**
   - **不需要**把墨墨用户 Token 放进 Secrets
   - Variables（可选）：`VITE_MAIMEMO_ISSUER` / `VITE_MAIMEMO_SCOPE` / `VITE_MAIMEMO_REDIRECT_URI`（仅 OIDC 高级路径用）
5. 推送到 `main` 后，Actions 自动发布 Pages
6. 打开：`https://qian-le.github.io/ciji/`
7. 手机浏览器 → 菜单 → **添加到主屏幕**

### 墨墨数据接入（官方开放 API + 用户 Token）

文档：https://open.maimemo.com/document#/

| 项 | 值 |
|----|-----|
| 获取 Token | 墨墨 App：我的 → 更多设置 → 实验功能 → 开放 API；或 https://open.maimemo.com/open/api/v1/tokens/openapi |
| 请求头 | `Authorization: Bearer <Token>` |
| 生产 Base | `https://open.maimemo.com/open` |
| 今日单词 | `POST /api/v1/memo/study/get_today_items` |
| 今日进度 | `POST /api/v1/memo/study/get_study_progress` |
| 学习记录 | `POST /api/v1/memo/study/query_study_records` |

App 设置页：粘贴 Token → 保存 → 「测试 Token」→「同步学习数据」。

注意（官方说明）：

- 学习数据接口为**公测**，不保证可用性
- 需在墨墨 App 中**开启自动同步**
- 若当日未打开 App 初始化，今日列表可能为空
- Token **只存本机 IndexedDB**，不进 GitHub、不进备份导出

响应字段映射：`voc_spelling` → 单词，`is_new` → 新词/复习，`first_response`/`last_response`（FAMILIAR/VAGUE/FORGET/WELL_FAMILIAR）→ 掌握度，`study_count` → 频次，`tags: STICKING` → 薄弱。

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
