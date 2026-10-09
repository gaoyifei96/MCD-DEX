/**
 * 本地静态服务器（可选）
 * 直接双击 web/index.html 也能用；想避免浏览器对本地文件的限制时再用它。
 * 用法：node src/serve.mjs [port]
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);

    // 根路径必须重定向到 /web/index.html，而不是直接返回它的内容。
    // 否则页面的 base URL 会是 /，index.html 里的 src="../data/catalog.js"
    // 解析出的 ../ 就跑到了站点根目录之外，浏览器不会发起请求 —— 表现就是脚本
    // 全部不加载、页面停在初始文案且按钮无响应。
    if (urlPath === '/' || urlPath === '') {
      res.writeHead(302, { Location: '/web/index.html' }).end();
      return;
    }

    let rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');

    // 目录穿越防护：解析后必须仍在项目根目录内
    const target = resolve(ROOT, '.' + rel);
    if (!target.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    const body = await readFile(target);
    res.writeHead(200, { 'Content-Type': MIME[extname(target)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
}).listen(PORT, () => {
  console.log(`麦麦图鉴已启动 → http://localhost:${PORT}`);
});
