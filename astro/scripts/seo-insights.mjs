#!/usr/bin/env node
/**
 * SEO 机会自动挖掘脚本 -- 分析 /api/blog-stats 聚合数据，生成 SEO 优化建议。
 *
 * 展示层归类：📊 开发者洞察层（仅输出 Markdown 报告 + GitHub Issue）
 * ❌ 禁止在前端展示 SEO 分数
 *
 * 用法：node scripts/seo-insights.mjs
 * 分支名：infra/seo-pipeline
 *
 * 输出：tmp/seo-insights-report.md
 *
 * 数据源：/api/blog-stats（公开聚合端点，无需 admin token）
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const PB_URL = process.env.PUBLIC_POCKETBASE_URL || 'http://localhost:8090';
const REPORT_DIR = join(process.cwd(), 'tmp');

async function fetchBlogStats() {
  try {
    const res = await fetch(`${PB_URL}/api/blog-stats?range=30d`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('❌ 无法获取 blog-stats 数据:', err instanceof Error ? err.message : err);
    return null;
  }
}

async function fetchPosts() {
  try {
    const filter = encodeURIComponent('status = "published"');
    const res = await fetch(`${PB_URL}/api/collections/posts/records?filter=${filter}&perPage=200&fields=id,title,slug,excerpt`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.items || [];
  } catch {
    return [];
  }
}

function generateReport(stats, posts) {
  const topPages = stats?.topPages || [];
  const totalViews = stats?.totalViews || 0;
  const uniqueVisitors = stats?.uniqueVisitors || 0;

  const postMap = {};
  for (const p of posts) {
    postMap[`/posts/${p.slug}`] = p;
  }

  const top10 = topPages.slice(0, 10).map((p, i) => ({
    rank: i + 1,
    path: p.path,
    views: p.views,
    title: postMap[p.path]?.title || p.path,
    hasExcerpt: !!postMap[p.path]?.excerpt,
  }));

  const noExcerpt = top10.filter((r) => r.path.startsWith('/posts/') && !r.hasExcerpt);
  const lowViews = posts
    .map((p) => ({ title: p.title, path: `/posts/${p.slug}`, views: topPages.find((tp) => tp.path === `/posts/${p.slug}`)?.views || 0 }))
    .filter((r) => r.views < 5)
    .slice(0, 10);

  return `# SEO 机会洞察报告

> 生成时间：${new Date().toISOString()}
> 数据源：PocketBase /api/blog-stats（近 30 天）

## 📊 流量概览

- 总浏览量：${totalViews}
- 独立访客：${uniqueVisitors}

## 📊 流量 TOP 10

| 排名 | 页面 | 浏览量 | 有摘要 |
|------|------|--------|--------|
${top10.map((r) => `| ${r.rank} | [${r.title}](${r.path}) | ${r.views} | ${r.hasExcerpt ? '✅' : '❌'} |`).join('\n')}

## ⚠️ 缺少摘要的高流量文章

${noExcerpt.length ? noExcerpt.slice(0, 5).map((r) => `- [${r.title}](${r.path}) - ${r.views} 次浏览`).join('\n') : '✅ 所有文章均有摘要'}

## 💡 低流量文章（可能需要 SEO 优化）

${lowViews.length ? lowViews.map((r) => `- [${r.title}](${r.path}) - ${r.views} 次浏览`).join('\n') : '✅ 所有文章均有合理流量'}

## 🔧 优化建议

1. **补充摘要**：为缺少 excerpt 的文章添加 100-150 字摘要
2. **内部链接**：在高流量文章中添加指向低流量文章的链接
3. **标题优化**：检查低流量文章标题是否包含目标关键词
4. **JSON-LD**：确保所有文章页有结构化数据
5. **Sitemap**：确认 sitemap.xml 包含所有已发布文章

---
*此报告由 seo-insights 脚本自动生成，仅供博主参考。*
`;
}

async function main() {
  console.log('=== SEO 机会挖掘 ===\n');

  const [stats, posts] = await Promise.all([fetchBlogStats(), fetchPosts()]);
  console.log(`获取到 ${stats?.topPages?.length || 0} 个页面统计，${posts.length} 篇文章`);

  if (!stats) {
    console.log('⚠️ 无统计数据，跳过分析');
    return;
  }

  const report = generateReport(stats, posts);

  mkdirSync(REPORT_DIR, { recursive: true });
  const reportPath = join(REPORT_DIR, 'seo-insights-report.md');
  writeFileSync(reportPath, report, 'utf-8');

  console.log(`\n✅ 报告已生成: ${reportPath}`);
}

main().catch(console.error);
