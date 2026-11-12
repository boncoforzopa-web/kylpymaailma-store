// Local preview: node scripts/dev.js  ->  http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');
const handler = require('../api/index');
const pub = path.join(__dirname, '..', 'public');
const types = { '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const f = path.join(pub, p);
  if (p !== '/' && f.startsWith(pub) && fs.existsSync(f) && fs.statSync(f).isFile()) {
    res.setHeader('Content-Type', types[path.extname(f)] || 'application/octet-stream');
    return fs.createReadStream(f).pipe(res);
  }
  req.headers['x-forwarded-proto'] = 'http';
  handler(req, res);
}).listen(process.env.PORT || 3000, () => console.log('dev on', process.env.PORT || 3000));
