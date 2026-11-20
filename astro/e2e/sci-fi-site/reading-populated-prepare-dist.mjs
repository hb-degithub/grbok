/**
 * 把刚构建好的 `astro/dist` 复制到独立的 `astro/tmp/reading-populated/dist`，
 * 供 Playwright 的 SSR webServer 从副本启动。
 *
 * 原因（2026-11-20 验收实测）：仓库里同时有多个 agent 在改 src 并各自执行
 * `npm run build`，构建会原地重写 `astro/dist`。验收套件运行中如果撞上别人的
 * 构建，`/_astro/*.js|css` 会瞬时 500，浏览器报「Failed to load resource」，
 * 把真实的阅读页断言淹没成噪声。副本让一次验收只对应一次确定的构建。
 *
 * 副本位置固定且校验前缀，避免误删其它目录。
 */
import { cpSync, existsSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

const ASTRO_DIR = path.resolve(import.meta.dirname, '..', '..');
const DIST = path.join(ASTRO_DIR, 'dist');
// 必须放在 astro/ 下：standalone entry 以裸包名 import react 等依赖，
// Node 会从副本所在目录逐级向上找 node_modules；放到仓库根 tmp/ 会解析不到。
const TMP_ROOT = path.resolve(ASTRO_DIR, 'tmp', 'reading-populated');
const TARGET = path.join(TMP_ROOT, 'dist');

if (!TARGET.startsWith(TMP_ROOT + path.sep)) {
  throw new Error(`refusing to remove unexpected path: ${TARGET}`);
}
for (const required of ['server/entry.mjs', 'client']) {
  if (!existsSync(path.join(DIST, required))) {
    console.error(`[reading-dist] missing dist/${required}; build first:`);
    console.error('  cd astro && ALLOW_LOCALHOST_SITE=1 PUBLIC_POCKETBASE_URL=http://127.0.0.1:8199 npm run build');
    process.exit(1);
  }
}

rmSync(TARGET, { recursive: true, force: true });
cpSync(DIST, TARGET, { recursive: true });

const entry = path.join(TARGET, 'server', 'entry.mjs');
console.log(`[reading-dist] copied build (${statSync(entry).mtime.toISOString()}) -> ${entry}`);
