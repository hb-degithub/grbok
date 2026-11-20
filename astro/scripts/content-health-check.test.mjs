/**
 * content-health-check.mjs 的直接测试（node --test）。
 *
 * 目标：验证 dist HTML 兼容路径与「无 HTML 时请求生产公开页面」的兜底路径，
 * 以及空采集**不会**被当成通过。全部使用本地 fixture / 回环 HTTP 服务，
 * 不访问真实互联网。
 *
 * 运行：cd astro && node --test scripts/content-health-check.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PUBLIC_PAGE_PATHS,
  buildPageUrl,
  collectHtmlFiles,
  collectRemoteLinks,
  extractExternalLinksFromHtml,
  extractLinksFromHtmlFiles,
  parseSiteUrl,
  resolveExitCode,
  resolveSiteUrl,
} from './content-health-check.mjs';

const SCRIPT_PATH = fileURLToPath(new URL('./content-health-check.mjs', import.meta.url));

/** 构造一个最小的 fetch 替身（不联网），可按 URL 返回 HTML 或错误。 */
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url) => {
    const key = String(url);
    calls.push(key);
    const entry = routes[key];
    if (entry === undefined) return { ok: true, status: 200, text: async () => '<html></html>' };
    if (entry instanceof Error) throw entry;
    if (typeof entry === 'string') {
      return { ok: true, status: 200, text: async () => entry };
    }
    return {
      ok: entry.ok !== false,
      status: entry.status ?? 200,
      text: async () => entry.html ?? '',
    };
  };
  impl.calls = calls;
  return impl;
}

function makeTempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** 启动回环站点：GET 返回含指定外链的 HTML，HEAD 按 deadPaths 返回 200/404。 */
async function startSite({ linkFactory = () => [], deadPaths = [] } = {}) {
  let externalLinks = [];
  const server = createServer((req, res) => {
    if (req.method === 'HEAD') {
      res.statusCode = deadPaths.includes(req.url) ? 404 : 200;
      res.end();
      return;
    }
    const body = externalLinks.map((url) => `<a href="${url}">link</a>`).join('');
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(`<html><body>${body}</body></html>`);
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  // 站点自身用 localhost，外链指向 127.0.0.1，避免被「站内链接」过滤规则吞掉。
  const externalBase = `http://127.0.0.1:${port}`;
  externalLinks = linkFactory(externalBase);
  return {
    siteUrl: `http://localhost:${port}`,
    externalBase,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** 以子进程方式运行脚本，返回退出码与输出。 */
function runScript({ cwd, siteUrl }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT_PATH], {
      cwd,
      env: { ...process.env, PUBLIC_SITE_URL: siteUrl },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('extractExternalLinksFromHtml 只保留站外绝对外链并去重', () => {
  const html = [
    '<a href="https://github.com/hb">gh</a>',
    '<a href="https://github.com/hb">gh duplicate</a>',
    '<a href="https://hlydwz.com/posts/hello">own site</a>',
    '<a href="/posts">relative</a>',
    '<a href="mailto:hb@hlydwz.com">mail</a>',
    '<a href="http://localhost:4321/dev">dev</a>',
    '<a href="https://example.com/demo">example</a>',
    "<a href='https://single-quote.example.org/x'>single quote ignored</a>",
  ].join('\n');

  assert.deepEqual(extractExternalLinksFromHtml(html, 'hlydwz.com'), ['https://github.com/hb']);
});

test('extractExternalLinksFromHtml 在无站点 host 时仍排除 localhost/example.com', () => {
  const html =
    '<a href="https://astro.build">astro</a><a href="http://localhost:4321">dev</a>' +
    '<a href="https://example.com/x">demo</a>';

  assert.deepEqual(extractExternalLinksFromHtml(html), ['https://astro.build']);
});

test('parseSiteUrl / buildPageUrl 由 PUBLIC_SITE_URL 拼出公开页面地址', () => {
  const site = parseSiteUrl('https://hlydwz.com');
  assert.deepEqual(site, { origin: 'https://hlydwz.com', host: 'hlydwz.com' });
  assert.equal(buildPageUrl(site.origin, '/posts'), 'https://hlydwz.com/posts');
  assert.equal(buildPageUrl('https://hlydwz.com/', '/'), 'https://hlydwz.com/');

  assert.equal(parseSiteUrl(''), null);
  assert.equal(parseSiteUrl('not-a-url'), null);
  assert.equal(parseSiteUrl('ftp://hlydwz.com'), null);
});

test('resolveSiteUrl：PUBLIC_SITE_URL 优先，缺失时回退构建产物 sitemap', () => {
  const dir = makeTempDir('content-health-sitemap-');
  try {
    mkdirSync(join(dir, 'client'), { recursive: true });
    writeFileSync(
      join(dir, 'client', 'sitemap-index.xml'),
      '<?xml version="1.0"?><sitemapindex><sitemap><loc>https://hlydwz.com/sitemap-0.xml</loc></sitemap></sitemapindex>',
    );

    const fromEnv = resolveSiteUrl({ envUrl: 'https://hlydwz.com', distDir: dir });
    assert.equal(fromEnv.origin, 'https://hlydwz.com');
    assert.equal(fromEnv.source, 'PUBLIC_SITE_URL');

    const fromSitemap = resolveSiteUrl({ envUrl: '', distDir: dir });
    assert.equal(fromSitemap.origin, 'https://hlydwz.com');
    assert.match(fromSitemap.source, /sitemap-index\.xml$/);

    // 构建产物若指向 localhost（本地测试构建），不能当作生产站点
    writeFileSync(join(dir, 'client', 'sitemap-index.xml'), '<sitemapindex><loc>http://localhost:4321/sitemap-0.xml</loc></sitemapindex>');
    assert.equal(resolveSiteUrl({ envUrl: '', distDir: dir }), null);

    assert.equal(resolveSiteUrl({ envUrl: '', distDir: null }), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('collectHtmlFiles 递归收集 dist HTML（保留 dist 模式兼容）', () => {
  const dir = makeTempDir('content-health-files-');
  try {
    mkdirSync(join(dir, 'posts'), { recursive: true });
    mkdirSync(join(dir, 'client', 'assets'), { recursive: true });
    writeFileSync(join(dir, 'index.html'), '<a href="https://a.example.org">a</a>');
    writeFileSync(join(dir, 'posts', 'hello.html'), '<a href="https://b.example.org">b</a>');
    writeFileSync(join(dir, 'client', 'assets', 'app.js'), 'console.log(1)');

    const files = collectHtmlFiles(dir);
    assert.equal(files.length, 2);
    assert.ok(files.every((file) => file.endsWith('.html')));
    assert.deepEqual(extractLinksFromHtmlFiles(files, 'hlydwz.com').sort(), [
      'https://a.example.org',
      'https://b.example.org',
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('collectRemoteLinks 抓取生产公开页面并提取外链，失败页面单独记录', async () => {
  const fetchImpl = fakeFetch({
    'https://hlydwz.com/':
      '<a href="https://github.com/hb">gh</a><a href="https://hlydwz.com/about">own</a>',
    'https://hlydwz.com/about': '<a href="https://astro.build">astro</a>',
    'https://hlydwz.com/posts': { ok: false, status: 500, html: '' },
  });

  const result = await collectRemoteLinks({
    siteOrigin: 'https://hlydwz.com',
    siteHost: 'hlydwz.com',
    paths: ['/', '/about', '/posts'],
    fetchImpl,
  });

  assert.deepEqual(result.links.sort(), ['https://astro.build', 'https://github.com/hb']);
  assert.deepEqual(result.pages.map((page) => page.url), [
    'https://hlydwz.com/',
    'https://hlydwz.com/about',
  ]);
  assert.equal(result.failedPages.length, 1);
  assert.equal(result.failedPages[0].url, 'https://hlydwz.com/posts');
  assert.equal(result.failedPages[0].status, 500);
});

test('collectRemoteLinks 默认请求全部主要公开页面', async () => {
  const fetchImpl = fakeFetch({});
  const result = await collectRemoteLinks({
    siteOrigin: 'https://hlydwz.com',
    siteHost: 'hlydwz.com',
    fetchImpl,
  });

  assert.equal(result.pages.length, PUBLIC_PAGE_PATHS.length);
  assert.deepEqual(fetchImpl.calls, PUBLIC_PAGE_PATHS.map((p) => buildPageUrl('https://hlydwz.com', p)));
});

test('resolveExitCode：空采集返回 3，绝不返回 0', () => {
  assert.equal(resolveExitCode({ collectedLinks: 0, deadLinks: 0 }), 3);
  assert.equal(resolveExitCode({ collectedLinks: 0 }), 3);
  assert.equal(resolveExitCode({ collectedLinks: 5, deadLinks: 0 }), 0);
  assert.equal(resolveExitCode({ collectedLinks: 5, deadLinks: 1 }), 1);
});

test('CLI：dist HTML 模式下沿用构建产物并检查外链', async () => {
  const site = await startSite();
  const cwd = makeTempDir('content-health-dist-');
  try {
    mkdirSync(join(cwd, 'dist'), { recursive: true });
    writeFileSync(
      join(cwd, 'dist', 'index.html'),
      `<a href="${site.externalBase}/healthy">ok</a><a href="/posts">internal</a>`,
    );

    const { code, stdout } = await runScript({ cwd, siteUrl: '' });
    assert.equal(code, 0, `期望 0，实际 ${code}\n${stdout}`);
    assert.match(stdout, /采集模式：dist HTML/);
    assert.match(stdout, /全部 1 个外链可达/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    await site.close();
  }
});

test('CLI：dist HTML 模式下用构建产物 sitemap 过滤站内链接', async () => {
  const site = await startSite();
  const cwd = makeTempDir('content-health-dist-site-');
  try {
    mkdirSync(join(cwd, 'dist', 'client'), { recursive: true });
    writeFileSync(
      join(cwd, 'dist', 'client', 'sitemap-index.xml'),
      '<sitemapindex><sitemap><loc>https://hlydwz.com/sitemap-0.xml</loc></sitemap></sitemapindex>',
    );
    writeFileSync(
      join(cwd, 'dist', 'index.html'),
      `<a href="https://hlydwz.com/about">own site</a><a href="${site.externalBase}/healthy">external</a>`,
    );

    const { code, stdout } = await runScript({ cwd, siteUrl: '' });
    assert.equal(code, 0, `期望 0，实际 ${code}\n${stdout}`);
    assert.match(stdout, /采集模式：dist HTML/);
    assert.match(stdout, /发现 1 个外链/);
    assert.doesNotMatch(stdout, /hlydwz\.com\/about/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    await site.close();
  }
});

test('CLI：无 dist HTML 时请求 PUBLIC_SITE_URL 的生产公开页面', async () => {
  const site = await startSite();
  const cwd = makeTempDir('content-health-remote-');
  try {
    const { code, stdout, stderr } = await runScript({
      cwd,
      siteUrl: site.siteUrl,
    });

    assert.equal(code, 3, `站点没有外链时应返回 3（未验证任何链接），实际 ${code}\n${stdout}`);
    assert.match(stdout, /采集模式：生产页面/);
    assert.match(stdout, /成功采集 10\/10 个页面/);
    assert.match(stdout, /发现 0 个外链/);
    assert.match(stderr, /未采集到任何外链/);
    assert.match(stderr, /不能视为「通过」/);
    assert.doesNotMatch(stdout, /全部 \d+ 个外链可达/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    await site.close();
  }
});

test('CLI：生产页面中的外链全部可达时退出码为 0', async () => {
  const site = await startSite({ linkFactory: (base) => [`${base}/health/ok`] });
  const cwd = makeTempDir('content-health-remote-ok-');
  try {
    const { code, stdout, stderr } = await runScript({
      cwd,
      siteUrl: site.siteUrl,
    });

    assert.equal(code, 0, `期望 0，实际 ${code}\n${stdout}\n${stderr}`);
    assert.match(stdout, /成功采集 10\/10 个页面/);
    assert.match(stdout, /全部 1 个外链可达/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    await site.close();
  }
});

test('CLI：生产页面中的外链不可达时退出码为 1', async () => {
  const site = await startSite({
    linkFactory: (base) => [`${base}/health/dead`],
    deadPaths: ['/health/dead'],
  });
  const cwd = makeTempDir('content-health-remote-dead-');
  try {
    const { code, stdout, stderr } = await runScript({
      cwd,
      siteUrl: site.siteUrl,
    });

    assert.equal(code, 1, `期望 1，实际 ${code}\n${stdout}`);
    assert.match(stderr, /个外链不可达/);
    assert.match(stderr, /\/health\/dead/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    await site.close();
  }
});

test('CLI：无 HTML 且无 PUBLIC_SITE_URL 时明确失败而不是通过', async () => {
  const cwd = makeTempDir('content-health-nosite-');
  try {
    const { code, stderr } = await runScript({ cwd, siteUrl: '' });
    assert.equal(code, 3, `期望 3，实际 ${code}`);
    assert.match(stderr, /无法确定生产站点地址/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
