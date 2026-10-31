/**
 * 本地静态预览服务（零依赖）
 * 用法：node tools/serve.js [端口]     默认 8123
 * 然后浏览器打开 http://localhost:8123/
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PORT = parseInt(process.argv[2], 10) || 8123;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
               '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
               '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  if (file.indexOf(ROOT) !== 0) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log('serving ' + ROOT + ' at http://localhost:' + PORT + '/'));
