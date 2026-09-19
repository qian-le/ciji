/**
 * Cloudflare Worker — 最小 AI Relay（可选）
 *
 * 仅当浏览器无法直连 MiMo（CORS）时部署。
 * MiMo API Key 存为 Worker Secret，绝不写入本文件或 GitHub。
 *
 * 部署：
 *   npx wrangler deploy cloudflare/worker.js --name ciji-ai
 *   npx wrangler secret put MIMO_API_KEY --name ciji-ai
 *
 * 然后在 GitHub Pages 变量 VITE_AI_RELAY_URL 填：
 *   https://ciji-ai.<subdomain>.workers.dev/api/ai
 *
 * 实测（2026-09）：api.xiaomimimo.com 已返回 Access-Control-Allow-Origin: *
 * 因此默认可走前端直连，本 Worker 仅作备用。
 */
export default {
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname !== '/api/ai' && url.pathname !== '/api/ai/') {
      return json({ error: 'Not found. Use POST /api/ai' }, 404)
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      })
    }
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405)
    }

    const key = globalThis.MIMO_API_KEY
    if (!key) return json({ error: 'MIMO_API_KEY not configured' }, 500)

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
      body: JSON.stringify({ model, messages, temperature: body.temperature ?? 0.7 }),
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
