// 大六壬 AI 白话解读代理（腾讯云 SCF Web函数版）
// 2026-11-18：EdgeOne 默认域名对大陆强制预览签名（3 小时过期 → 401），改走 SCF 函数 URL。
// v2：上游请求改用 Node 内置 https 模块——Node 16 没有全局 fetch，首版在 Node16 运行时
//     一到上游调用就崩（表现为函数 URL 返回 502）。https 模块 16/18/20 通吃。
// 部署：SCF 控制台新建「Web函数」（Node.js）→ 粘贴本文件全部内容 → 高级配置环境变量
//       GLM_KEY=智谱Key → 创建 → 函数配置里开启「函数URL」（公网访问，无鉴权）→
//       执行超时时间改 30 秒 → 把函数 URL 填进 index.html 的 AI_PROXY。
// 密钥纪律不变：GLM_KEY 只存平台环境变量，不进仓库、不进前端。

const http = require('http');
const https = require('https');

const PORT = 9000; // SCF Web函数约定端口
const GLM_HOST = 'open.bigmodel.cn';
const GLM_PATH = '/api/paas/v4/chat/completions';

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

// 用内置 https 模块 POST 上游（Promise 封装）
function callGlm(key, prompt) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: 'glm-4-flash',        // 智谱免费档，方案C零边际成本；要更好质量换 glm-4-air
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 2048,            // 新手向解读 600-900 字，1024 会截断
    });
    const req = https.request({
      hostname: GLM_HOST,
      path: GLM_PATH,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key,
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 25000,
    }, (up) => {
      let data = '';
      up.on('data', (c) => { data += c; });
      up.on('end', () => {
        if (up.statusCode !== 200) { reject(new Error('上游 ' + up.statusCode)); return; }
        try {
          const uj = JSON.parse(data);
          const text = (uj.choices && uj.choices[0] && uj.choices[0].message && uj.choices[0].message.content) || '';
          resolve(text);
        } catch (e) { reject(new Error('上游响应解析失败')); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('上游超时')); });
    req.on('error', (e) => reject(e));
    req.write(payload);
    req.end();
  });
}

const server = http.createServer((req, res) => {
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
      const text = await callGlm(key, prompt);
      send(res, 200, { text });
    } catch (e) {
      send(res, 502, { error: '上游请求失败: ' + e.message });
    }
  });
});

server.listen(PORT, () => {
  console.log('daliuren ai proxy listening on ' + PORT);
});
