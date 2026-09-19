# 词迹安全模型（公网 GitHub Pages）

## 问题

若把 MiMo API Key 用 `VITE_MIMO_API_KEY` **构建进前端**，再部署到公开 Pages：

- 任何访客打开 DevTools / 下载 JS 即可扒走 Key
- Secret 存在 GitHub 也不能阻止「构建后出现在公网产物里」

**结论：公开前端不能承载可被爬取的长期密钥。**

## 密钥应放在哪

| 数据 | 位置 | 是否进 Git / 公网 JS |
|------|------|----------------------|
| MiMo API Key（推荐） | Cloudflare Worker **Secret** | 否 |
| MiMo API Key（备用） | 仅本机浏览器 IndexedDB（设置页粘贴） | 否 |
| 墨墨用户 Token | 仅本机 IndexedDB | 否 |
| 学习数据 / AI 结果 | 本机 IndexedDB | 否 |
| `client_id`（可选 OIDC） | 前端可公开 | 可 |
| `client_secret` | **禁止出现** | 否 |

## 推荐架构（有 Worker）

```text
手机浏览器（词迹 Pages）
    │  POST /api/ai  （不带 Key）
    ▼
Cloudflare Worker（MIMO_API_KEY Secret）
    │  Authorization: Bearer <secret>
    ▼
https://api.xiaomimimo.com/v1
```

部署见仓库 `cloudflare/worker.js` 与下方步骤。

## 备用（无 Worker）

1. 打开 https://qian-le.github.io/ciji/
2. 设置 → MiMo API → 粘贴 Key → 保存（只写本机 IndexedDB）
3. 公网 JS 里**不会**包含该 Key

## 仓库侧已做的防护

- `.gitignore` 忽略 `.env`
- GitHub Actions **不再**注入 `VITE_MIMO_API_KEY`
- 运行时仅 `localhost` 允许读本地 `.env` Key
- 备份导出剥离 Token / API Key

## 你本地应做的事

1. **立刻改掉**已泄露的 MiMo Key（若已在公网包里出现过）
2. 在 [Xiaomi MiMo 开放平台](https://platform.xiaomimimo.com) 重新生成 Key
3. 新 Key：只放 Cloudflare Secret，或只粘贴在自己手机的设置里
4. 删除 GitHub 上不再使用的 `VITE_MIMO_API_KEY` Secret（避免误注入）

## Cloudflare Worker 部署（最少步骤）

```bash
npm i -g wrangler
wrangler login
cd D:\ciji
wrangler deploy cloudflare/worker.js --name ciji-ai
# 交互输入新生成的 MiMo Key（不会写入仓库）
wrangler secret put MIMO_API_KEY --name ciji-ai
```

然后在 GitHub：

- Settings → Secrets and variables → Actions → **Variables**
- 新增 `VITE_AI_RELAY_URL` = `https://ciji-ai.<你的subdomain>.workers.dev/api/ai`
- push 或手动跑 workflow 部署 Pages

前端设置页可把 Relay 地址也填一遍（若构建未注入变量）。
