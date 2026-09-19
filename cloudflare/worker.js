/**
 * Cloudflare Worker — MiMo 最小中继（安全推荐路径）
 *
 * MiMo API Key 只放在 Worker Secret，绝不写入本文件或 GitHub 仓库，
 * 也绝不打进 GitHub Pages 前端包。
 *
 * 部署：
 *   npm i -g wrangler
 *   wrangler login
 *   npx wrangler deploy cloudflare/worker.js --name ciji-ai
 *   npx wrangler secret put MIMO_API_KEY --name ciji-ai
 *
 * GitHub Variables：
 *   VITE_AI_RELAY_URL=https://ciji-ai.<subdomain>.workers.dev/api/ai
 */
export default {
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname !== '/api/ai' && url.pathname !== '/api/ai/') {
      return json({ error: 'Not found. Use POST /api/ai' }, 404)
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() })
    }
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405)
    }

    const key = globalThis.MIMO_API_KEY
    if (!key) return json({ error: 'MIMO_API_KEY not configured on Worker' }, 500)

    let body
    try {
      body = await request.json()
    } catch {
      return json({ error: 'Invalid JSON body' }, 400)
    }

    const model = body.model || 'mimo-v2.5'
    const messages = body.messages
    if (!Array.isArray(messages)) return json({ error: 'messages required' }, 400)

    const upstream = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: body.temperature ?? 0.7,
      }),
    })

    const text = await upstream.text()
    return new Response(text, {
      status: upstream.status,
      headers: {
        ...corsHeaders(),
        'Content-Type': 'application/json; charset=utf-8',
      },
    })
  },
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type,x-ciji-client',
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json; charset=utf-8' },
  })
}
