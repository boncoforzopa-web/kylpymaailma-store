// Copies theme assets to the same public path Shopify used (/cdn/shop/t/18/assets/…).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const src = path.join(root, 'theme', 'assets');
const dest = path.join(root, 'public', 'cdn', 'shop', 't', '18', 'assets');
fs.mkdirSync(dest, { recursive: true });
for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(dest, f));
console.log('copied', fs.readdirSync(src).length, 'theme assets');
