// 大六壬 AI 白话解读代理（腾讯云 SCF Web函数版）
// 2026-11-18：EdgeOne 默认域名对大陆强制预览签名（3 小时过期 → 401），改走 SCF 函数 URL。
// 部署：SCF 控制台新建「Web函数」（Node.js）→ 粘贴本文件全部内容 → 高级配置环境变量
//       GLM_KEY=智谱Key → 创建 → 函数配置里开启「函数URL」（公网访问，无鉴权）→
//       把函数 URL 填进 index.html 的 AI_PROXY。
// 密钥纪律不变：GLM_KEY 只存平台环境变量，不进仓库、不进前端。

const http = require('http');

const PORT = 9000; // SCF Web函数约定端口
const GLM_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',   // 页面在 santeb.github.io，公开页面公开源
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { send(res, 204, {}); return; }
  if (req.method !== 'POST') { send(res, 405, { error: 'POST only' }); return; }

  const key = process.env.GLM_KEY;
  if (!key) { send(res, 500, { error: 'GLM_KEY 未配置' }); return; }

  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 64 * 1024) req.destroy(); });
  req.on('end', async () => {
    let j;
    try { j = JSON.parse(body); } catch (e) { send(res, 400, { error: 'bad json' }); return; }
    const prompt = j && typeof j.prompt === 'string' ? j.prompt : '';
    if (!prompt || prompt.length > 4000) {
      send(res, 400, { error: 'prompt 非法或超长' }); return;
    }

    try {
      const up = await fetch(GLM_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + key,
        },
        body: JSON.stringify({
          model: 'glm-4-flash',        // 智谱免费档，方案C零边际成本；要更好质量换 glm-4-air
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 1024,
        }),
      });
      if (!up.ok) { send(res, 502, { error: '上游 ' + up.status }); return; }
      const uj = await up.json();
      const text = (uj.choices && uj.choices[0] && uj.choices[0].message && uj.choices[0].message.content) || '';
      send(res, 200, { text });
    } catch (e) {
      send(res, 502, { error: '上游请求失败: ' + e.message });
    }
  });
});

server.listen(PORT, () => {
  console.log('daliuren ai proxy listening on ' + PORT);
});
