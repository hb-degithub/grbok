#!/usr/bin/env node
/**
 * 友链存活检测脚本 —— 检查 PocketBase friend_links 表中的 URL 是否可达。
 *
 * 用法：node scripts/check-friend-links.mjs
 * 环境变量：PUBLIC_POCKETBASE_URL（默认 http://localhost:8090）
 */

const PB_URL = process.env.PUBLIC_POCKETBASE_URL || 'http://localhost:8090';
const TIMEOUT_MS = 5000;

async function fetchFriendLinks() {
  const res = await fetch(`${PB_URL}/api/collections/friend_links/records?perPage=200`);
  if (!res.ok) throw new Error(`PocketBase 返回 ${res.status}`);
  const data = await res.json();
  return data.items || [];
}

async function checkUrl(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    // 用 GET 而非 HEAD，因为部分站点不支持 HEAD
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'blog-friend-link-checker/1.0' },
    });
    clearTimeout(timer);
    return { alive: res.ok, status: res.status };
  } catch (err) {
    return { alive: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  console.log('=== 友链存活检测 ===\n');

  let links;
  try {
    links = await fetchFriendLinks();
  } catch (err) {
    console.error(`❌ 无法获取友链列表: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  console.log(`共 ${links.length} 个友链\n`);

  const results = [];
  for (const link of links) {
    process.stdout.write(`  检查: ${link.name} (${link.url}) ... `);
    const result = await checkUrl(link.url);
    results.push({ ...link, ...result });
    console.log(result.alive ? '✅' : `❌ ${result.status}`);
  }

  const dead = results.filter((r) => !r.alive);
  if (dead.length) {
    console.warn(`\n⚠️  ${dead.length} 个友链不可达：`);
    dead.forEach((d) => {
      console.warn(`  ❌ ${d.name}: ${d.url} (${d.status})`);
    });
    process.exit(1);
  } else {
    console.log(`\n✅ 全部 ${links.length} 个友链可达`);
  }
}

main().catch((err) => {
  console.error('检测脚本异常:', err);
  process.exit(2);
});
