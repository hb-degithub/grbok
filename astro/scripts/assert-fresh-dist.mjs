/**
 * 校验 `dist` 是否比源码新，避免浏览器验收套件对着旧构建「全绿」。
 *
 * 背景：e2e/sci-fi-site 直接启动 `node dist/server/entry.mjs`。如果改完源码
 * 忘了 build，Playwright 仍会把旧产物跑出一片通过，验收结论就是假的。
 * 这里在起服务前比较 mtime：dist/server/entry.mjs 必须不早于 src/** 里最新的文件。
 *
 * 用法：node scripts/assert-fresh-dist.mjs
 * 退出码：0 = 新鲜；1 = 过期或缺失（打印需要执行的命令）。
 */
import { statSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const entry = path.join(root, 'dist', 'server', 'entry.mjs');

function newestMtime(dir) {
  let newest = 0;
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      newest = Math.max(newest, newestMtime(full));
    } else {
      newest = Math.max(newest, statSync(full).mtimeMs);
    }
  }
  return newest;
}

let entryMtime;
try {
  entryMtime = statSync(entry).mtimeMs;
} catch {
  console.error('[assert-fresh-dist] 找不到 dist/server/entry.mjs，请先构建：');
  console.error('  cd astro && ALLOW_LOCALHOST_SITE=1 npm run build');
  process.exit(1);
}

const srcMtime = newestMtime(path.join(root, 'src'));
if (entryMtime < srcMtime) {
  const delta = Math.round((srcMtime - entryMtime) / 1000);
  console.error(`[assert-fresh-dist] dist 比源码旧 ${delta}s，验收会跑到旧产物。请先构建：`);
  console.error('  cd astro && ALLOW_LOCALHOST_SITE=1 npm run build');
  process.exit(1);
}

console.log('[assert-fresh-dist] dist 与源码一致（entry.mjs 不早于 src/**）。');
