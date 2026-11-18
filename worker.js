// 大六壬 AI 白话解读代理（Cloudflare Worker）
// 2026-11-18 方案C：免费限次试水。前端 index.html 已有限次（localStorage dlr_ai，每天 1 次），
// 这里做第二道防滥用：prompt 长度上限 + 每请求一次调用。
//
// 部署三步：
//   1. dash.cloudflare.com → Workers & Pages → Create Worker → 粘贴本文件 → Deploy
//   2. Worker → Settings → Variables and Secrets → 添加 GLM_KEY（智谱 open.bigmodel.cn 的 API Key）
//      （key 只存在 Worker 环境变量里，不进仓库、不进前端）
//   3. 把 Worker 的 https://<name>.<account>.workers.dev 地址填进 index.html 的 AI_PROXY 常量
//
// ⚠️ workers.dev 域名在大陆部分网络不可达。若用户反馈打不开：
//    给 Worker 绑自定义域名，或换腾讯云 EdgeOne Pages Functions 承接同一份代码。

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',   // 页面在 santeb.github.io，公开页面公开源
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export default {
  async fetch(req, env) {
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
  },
};
