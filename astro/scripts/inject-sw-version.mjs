import fs from 'fs';
import path from 'path';

const distPath = path.resolve('dist', 'sw.js');
if (!fs.existsSync(distPath)) {
  console.error('dist/sw.js not found');
  process.exit(1);
}

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const version = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

const content = fs.readFileSync(distPath, 'utf-8');
if (!content.includes('__CACHE_VERSION__')) {
  console.log('No __CACHE_VERSION__ placeholder found in dist/sw.js, skipping injection');
  process.exit(0);
}

const newContent = content.replace(/__CACHE_VERSION__/g, version);
fs.writeFileSync(distPath, newContent);
console.log(`Injected service worker cache version: ${version}`);
