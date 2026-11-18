// 大六壬 AI 白话解读代理（腾讯云 EdgeOne Pages Functions 版）
// 2026-11-18：Cloudflare workers.dev 在大陆被 DNS 污染（解析到无关 IP，TCP 不通），
// 同一份逻辑迁到 EdgeOne：国内直连可达，语法按 EdgeOne Functions（onRequest + context.env）。
// 部署：EdgeOne Pages 控制台导入本仓库 → 项目设置→环境变量加 GLM_KEY（Secret）→
//       默认域名形如 https://<project>.edgeone.app，函数路由 /api/ai，
//       把 https://<project>.edgeone.app/api/ai 填进 index.html 的 AI_PROXY。
// 密钥纪律不变：GLM_KEY 只存平台环境变量，不进仓库、不进前端。

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',   // 页面在 santeb.github.io，公开页面公开源
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export async function onRequest(context) {
  const req = context.request;
  const env = context.env;
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: CORS });
  }
  if (!env || !env.GLM_KEY) {
    return new Response(JSON.stringify({ error: 'GLM_KEY 未配置' }), { status: 500, headers: CORS });
  }

  let body;
  try { body = await req.json(); } catch (e) {
    return new Response(JSON.stringify({ error: 'bad json' }), { status: 400, headers: CORS });
  }
  const prompt = body && typeof body.prompt === 'string' ? body.prompt : '';
  if (!prompt || prompt.length > 4000) {
    return new Response(JSON.stringify({ error: 'prompt 非法或超长' }), { status: 400, headers: CORS });
  }

  const up = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + env.GLM_KEY,
    },
    body: JSON.stringify({
      model: 'glm-4-flash',        // 智谱免费档，方案C零边际成本；要更好质量换 glm-4-air
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 1024,
    }),
  });

  if (!up.ok) {
    return new Response(JSON.stringify({ error: '上游 ' + up.status }), { status: 502, headers: CORS });
  }
  let j;
  try { j = await up.json(); } catch (e) {
    return new Response(JSON.stringify({ error: '上游响应解析失败' }), { status: 502, headers: CORS });
  }
  const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
  return new Response(JSON.stringify({ text }), { headers: CORS });
}
