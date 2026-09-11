import fs from 'fs';
import path from 'path';

// SSR 构建下 sw.js 在 dist/client/；静态构建在 dist/。两处都尝试，都找不到才跳过。
const candidates = [path.resolve('dist', 'client', 'sw.js'), path.resolve('dist', 'sw.js')];
const distPath = candidates.find((p) => fs.existsSync(p));
if (!distPath) {
  console.log('sw.js not found in dist/client or dist, skipping injection');
  process.exit(0);
}

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const version = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

const content = fs.readFileSync(distPath, 'utf-8');
if (!content.includes('__CACHE_VERSION__')) {
  console.log(`No __CACHE_VERSION__ placeholder found in ${distPath}, skipping injection`);
  process.exit(0);
}

const newContent = content.replace(/__CACHE_VERSION__/g, version);
fs.writeFileSync(distPath, newContent);
console.log(`Injected service worker cache version: ${version} -> ${distPath}`);
