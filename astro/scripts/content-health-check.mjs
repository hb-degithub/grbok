#!/usr/bin/env node
/**
 * 内容健康度检查脚本 —— 扫描构建产物中所有外链的有效性。
 *
 * 用法：node scripts/content-health-check.mjs
 * 需先运行 npm run build 生成 dist/。
 *
 * GitHub Actions 定时任务每周一自动执行，失效链接会创建 Issue。
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const distDir = join(process.cwd(), 'dist');
const TIMEOUT_MS = 5000;
const CONCURRENCY = 8;

if (!existsSync(distDir)) {
  console.error('❌ dist/ 目录不存在，请先运行 npm run build');
  process.exit(1);
}

/** 递归收集所有 HTML 文件 */
function collectHtmlFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectHtmlFiles(fullPath));
    } else if (entry.name.endsWith('.html')) {
      files.push(fullPath);
    }
  }
  return files;
}

/** 从 HTML 中提取外链 */
function extractExternalLinks(htmlFiles) {
  const links = new Set();
  const linkRegex = /href="(https?:\/\/[^"]+)"/g;

  for (const file of htmlFiles) {
    const html = readFileSync(file, 'utf-8');
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      const url = match[1];
      // 排除本站与 localhost：从 PUBLIC_SITE_URL 提取 host
      const siteUrl = process.env.PUBLIC_SITE_URL || '';
      const siteHost = siteUrl ? new URL(siteUrl).host : '';
      if (siteHost && url.includes(siteHost)) continue;
      if (!url.includes('localhost') && !url.includes('example.com')) {
        links.add(url);
      }
    }
  }
  return [...links];
}

/** 检查单个 URL（HEAD 请求，超时 5s） */
async function checkUrl(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timer);
    return { url, alive: res.ok, status: res.status };
  } catch (err) {
    return { url, alive: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 并发检查（限制并发数避免被限流） */
async function checkAll(urls) {
  const results = [];
  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const batch = urls.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(checkUrl));
    results.push(...batchResults);
    process.stdout.write(`  已检查 ${Math.min(i + CONCURRENCY, urls.length)}/${urls.length}\r`);
  }
  console.log();
  return results;
}

async function main() {
  console.log('=== 内容健康度检查 ===\n');

  const htmlFiles = collectHtmlFiles(distDir);
  console.log(`扫描到 ${htmlFiles.length} 个 HTML 文件`);

  const links = extractExternalLinks(htmlFiles);
  console.log(`发现 ${links.length} 个外链\n`);

  if (!links.length) {
    console.log('✅ 无外链需要检查');
    return;
  }

  const results = await checkAll(links);
  const dead = results.filter((r) => !r.alive);

  if (dead.length) {
    console.warn(`\n⚠️  ${dead.length} 个外链不可达：`);
    dead.forEach((d) => {
      console.warn(`  ❌ [${d.status}] ${d.url}`);
      if (d.error) console.warn(`       ${d.error}`);
    });
    // 非 0 退出码触发 GitHub Actions 失败
    process.exit(1);
  } else {
    console.log(`\n✅ 全部 ${links.length} 个外链可达`);
  }
}

main().catch((err) => {
  console.error('检查脚本异常:', err);
  process.exit(2);
});
