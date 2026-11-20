#!/usr/bin/env node
/**
 * 内容健康度检查脚本 —— 采集站点外链并检测其可达性。
 *
 * 采集来源（按优先级）：
 *   1. dist HTML（兼容静态构建）：dist/ 下存在 *.html 时，从构建产物提取外链。
 *   2. 生产页面（SSR 兜底）：`output: 'server'` 的构建只产出 dist/client 静态资源与
 *      dist/server 入口，**不含任何 HTML**，dist 采集恒为 0 个文件；此时改用
 *      PUBLIC_SITE_URL 请求生产首页与主要公开页面
 *      （posts/tags/archive/about/links/guestbook/gallery/status/stats），
 *      从返回的 HTML 提取外链。只读公开页面，不做全站爬取，不校验站内链接。
 *
 * 用法：
 *   node scripts/content-health-check.mjs
 *   PUBLIC_SITE_URL=https://hlydwz.com node scripts/content-health-check.mjs
 *
 * 退出码：
 *   0 = 采集到外链且全部可达
 *   1 = 存在不可达的外链
 *   2 = 脚本异常
 *   3 = 未采集到任何可检查的外链（采集未生效，**不能**当作通过）
 *
 * GitHub Actions 定时任务每周一自动执行，非 0 退出码会创建 Issue。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const TIMEOUT_MS = 5000;
export const CONCURRENCY = 8;
/** 远程采集时的页面并发数：公开页面数量少，限并发避免被 WAF 判定为扫描。 */
const PAGE_CONCURRENCY = 4;
const USER_AGENT = 'hlydwz-content-health-check/2.0 (+https://hlydwz.com)';

/** 主要公开页面（SSR 无 HTML 时的采集入口）。 */
export const PUBLIC_PAGE_PATHS = [
  '/',
  '/posts',
  '/tags',
  '/archive',
  '/about',
  '/links',
  '/guestbook',
  '/gallery',
  '/status',
  '/stats',
];

export const EXIT_OK = 0;
export const EXIT_DEAD_LINKS = 1;
export const EXIT_ERROR = 2;
export const EXIT_NO_DATA = 3;

/** 递归收集所有 HTML 文件（dist 模式）。 */
export function collectHtmlFiles(dir) {
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

/** 解析 PUBLIC_SITE_URL，返回 origin/host；非法或缺失返回 null。 */
export function parseSiteUrl(raw) {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return { origin: url.origin, host: url.host };
  } catch {
    return null;
  }
}

/**
 * 解析本次检查的站点地址：
 *   1. PUBLIC_SITE_URL（显式指定，优先）；
 *   2. 构建产物 sitemap 里的绝对地址（CI 的 build 步骤带 PUBLIC_SITE_URL 构建，
 *      但后续 check 步骤不一定继承该环境变量；sitemap 由同一份 site 配置生成）。
 * localhost / 127.0.0.1 视为无效（不能把开发地址当生产站点扫描）。
 */
export function resolveSiteUrl({ envUrl, distDir, readFile = readFileSync, exists = existsSync } = {}) {
  const fromEnv = parseSiteUrl(envUrl);
  if (fromEnv) return { ...fromEnv, source: 'PUBLIC_SITE_URL' };

  if (!distDir) return null;
  const candidates = [
    join(distDir, 'client', 'sitemap-index.xml'),
    join(distDir, 'client', 'sitemap-0.xml'),
    join(distDir, 'sitemap-index.xml'),
    join(distDir, 'sitemap-0.xml'),
  ];
  for (const candidate of candidates) {
    let xml;
    try {
      if (!exists(candidate)) continue;
      xml = readFile(candidate, 'utf-8');
    } catch {
      continue;
    }
    const match = xml.match(/<loc>([^<]+)<\/loc>/);
    if (!match) continue;
    const site = parseSiteUrl(match[1]);
    if (!site) continue;
    if (/^(localhost|127\.)/.test(site.host)) continue;
    return { ...site, source: candidate };
  }
  return null;
}


/** 是否为需要检查的外链（排除站内、localhost、示例域名）。 */
export function isExternalUrl(url, siteHost = '') {
  if (!/^https?:\/\//i.test(url)) return false;
  if (siteHost && url.includes(siteHost)) return false;
  if (url.includes('localhost')) return false;
  if (url.includes('example.com')) return false;
  return true;
}

/** 从单个 HTML 文本中提取外链（去重；只匹配 href="..." 的绝对 http(s) 链接）。 */
export function extractExternalLinksFromHtml(html, siteHost = '') {
  const links = new Set();
  const linkRegex = /href\s*=\s*"([^"]+)"/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const url = match[1].trim();
    if (isExternalUrl(url, siteHost)) links.add(url);
  }
  return [...links];
}

/** 从一组 HTML 文件提取外链（dist 模式）。 */
export function extractLinksFromHtmlFiles(files, siteHost = '') {
  const links = new Set();
  for (const file of files) {
    for (const url of extractExternalLinksFromHtml(readFileSync(file, 'utf-8'), siteHost)) {
      links.add(url);
    }
  }
  return [...links];
}

/** 拼接页面 URL（相对路径挂到站点 origin 下）。 */
export function buildPageUrl(origin, pagePath) {
  const base = origin.endsWith('/') ? origin : `${origin}/`;
  return new URL(pagePath, base).toString();
}

/** 抓取单个页面 HTML；失败时返回 ok:false 而不是抛错。 */
export async function fetchPageHtml(url, { fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
    });
    if (!res.ok) return { url, ok: false, status: res.status, html: '' };
    const html = await res.text();
    return { url, ok: true, status: res.status, html };
  } catch (err) {
    return {
      url,
      ok: false,
      status: 0,
      html: '',
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 远程采集：请求生产公开页面并提取外链。
 * 返回 { links, pages（成功页面）, failedPages（失败页面） }。
 */
export async function collectRemoteLinks({
  siteOrigin,
  siteHost = '',
  paths = PUBLIC_PAGE_PATHS,
  fetchImpl = fetch,
  timeoutMs = TIMEOUT_MS,
  log = () => {},
} = {}) {
  const fetched = [];
  for (let i = 0; i < paths.length; i += PAGE_CONCURRENCY) {
    const batch = paths.slice(i, i + PAGE_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((pagePath) =>
        fetchPageHtml(buildPageUrl(siteOrigin, pagePath), { fetchImpl, timeoutMs }),
      ),
    );
    fetched.push(...batchResults);
    log(`  已抓取 ${Math.min(i + PAGE_CONCURRENCY, paths.length)}/${paths.length}`);
  }

  const links = new Set();
  const pages = [];
  const failedPages = [];
  for (const page of fetched) {
    if (page.ok) {
      pages.push({ url: page.url, status: page.status });
      for (const url of extractExternalLinksFromHtml(page.html, siteHost)) links.add(url);
    } else {
      failedPages.push({ url: page.url, status: page.status, error: page.error });
    }
  }
  return { links: [...links], pages, failedPages };
}

/** 退出码决策：空采集（0 个外链）绝不能算通过。 */
export function resolveExitCode({ collectedLinks, deadLinks = 0 }) {
  if (!Number.isFinite(collectedLinks) || collectedLinks <= 0) return EXIT_NO_DATA;
  return deadLinks > 0 ? EXIT_DEAD_LINKS : EXIT_OK;
}

/** 检查单个 URL（HEAD 请求，超时 5s）。 */
export async function checkUrl(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT },
    });
    clearTimeout(timer);
    return { url, alive: res.ok, status: res.status };
  } catch (err) {
    return { url, alive: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 并发检查（限制并发数避免被限流）。 */
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

  const distDir = join(process.cwd(), 'dist');
  const distExists = existsSync(distDir);
  const site = resolveSiteUrl({
    envUrl: process.env.PUBLIC_SITE_URL,
    distDir: distExists ? distDir : null,
  });

  let htmlFiles = [];
  if (distExists) {
    htmlFiles = collectHtmlFiles(distDir);
    console.log(`dist/ HTML：${htmlFiles.length} 个文件`);
  } else {
    console.warn('⚠️  dist/ 目录不存在，跳过构建产物采集');
  }

  let links = [];
  if (htmlFiles.length > 0) {
    links = extractLinksFromHtmlFiles(htmlFiles, site ? site.host : '');
    console.log(`采集模式：dist HTML（${htmlFiles.length} 个文件）`);
  } else {
    console.log('采集模式：生产页面（SSR 构建不产出 HTML，dist 采集为空）');
    if (!site) {
      console.error('❌ 未采集到 HTML，且无法确定生产站点地址，无法执行远程采集。');
      console.error('   请设置 PUBLIC_SITE_URL=https://<生产域名>，或先用带 PUBLIC_SITE_URL 的构建产出 dist/。');
      process.exitCode = EXIT_NO_DATA;
      return;
    }
    if (site.source !== 'PUBLIC_SITE_URL') {
      console.log(`站点地址：${site.origin}（PUBLIC_SITE_URL 未设置，取自构建产物 ${site.source}）`);
    } else {
      console.log(`站点地址：${site.origin}`);
    }

    console.log(`请求 ${site.origin} 的 ${PUBLIC_PAGE_PATHS.length} 个公开页面：`);
    console.log(`  ${PUBLIC_PAGE_PATHS.join(' ')}`);
    const remote = await collectRemoteLinks({
      siteOrigin: site.origin,
      siteHost: site.host,
      log: (message) => process.stdout.write(`${message}\r`),
    });
    process.stdout.write('\n');
    console.log(`成功采集 ${remote.pages.length}/${PUBLIC_PAGE_PATHS.length} 个页面`);

    if (remote.failedPages.length) {
      console.warn(`⚠️  ${remote.failedPages.length} 个页面采集失败（未参与外链提取）：`);
      for (const page of remote.failedPages) {
        const reason = page.error ? ` (${page.error})` : '';
        console.warn(`  - [${page.status || '网络错误'}] ${page.url}${reason}`);
      }
    }

    if (remote.pages.length === 0) {
      console.error('\n❌ 未采集到任何生产页面，本次检查未生效（不能视为通过）。');
      process.exitCode = EXIT_NO_DATA;
      return;
    }
    links = remote.links;
  }

  console.log(`\n发现 ${links.length} 个外链`);

  if (links.length === 0) {
    console.error('\n❌ 未采集到任何外链：本次没有任何链接被验证，结果不能视为「通过」。');
    console.error('   检查未生效，请确认采集页面渲染正常，或外链提取规则（href="https://…"）仍然适用。');
    process.exitCode = EXIT_NO_DATA;
    return;
  }

  console.log();
  const results = await checkAll(links);
  const dead = results.filter((result) => !result.alive);

  if (dead.length) {
    console.warn(`\n⚠️  ${dead.length}/${links.length} 个外链不可达：`);
    dead.forEach((d) => {
      console.warn(`  ❌ [${d.status}] ${d.url}`);
      if (d.error) console.warn(`       ${d.error}`);
    });
  } else {
    console.log(`\n✅ 全部 ${links.length} 个外链可达`);
  }

  process.exitCode = resolveExitCode({ collectedLinks: links.length, deadLinks: dead.length });
}

// 仅在直接执行时运行 main；被测试 import 时只暴露 helper（无副作用）。
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err) => {
    console.error('检查脚本异常:', err);
    process.exit(EXIT_ERROR);
  });
}
