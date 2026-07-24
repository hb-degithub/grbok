#!/usr/bin/env node
/**
 * 高价值内容识别引擎 -- 综合流量、互动数据，输出《数字产品建议书》。
 *
 * 展示层归类：📊 开发者洞察层（仅输出 Markdown 报告）
 * ❌ 禁止在前端展示"热门排行"
 *
 * 用法：node scripts/content-value-analysis.mjs
 * 分支名：infra/content-value-engine
 *
 * 输出：tmp/content-value-report.md
 *
 * 数据源：/api/blog-stats（浏览量聚合，公开端点）+ reactions + comments + posts
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const PB_URL = process.env.PUBLIC_POCKETBASE_URL || 'http://localhost:8090';
const REPORT_DIR = join(process.cwd(), 'tmp');

async function fetchBlogStats() {
  try {
    const res = await fetch(`${PB_URL}/api/blog-stats?range=30d`);
    if (!res.ok) throw new Error(String(res.status));
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchCollection(name, filter) {
  try {
    const qs = filter ? `filter=${encodeURIComponent(filter)}&` : '';
    const res = await fetch(`${PB_URL}/api/collections/${name}/records?${qs}perPage=500`);
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    return data.items || [];
  } catch {
    return [];
  }
}

async function fetchPosts() {
  return fetchCollection('posts', 'status = "published"');
}

function computeValueScore(stats, reactions, comments, posts) {
  const postViews = {};
  for (const p of stats?.topPages || []) {
    if (p.path.startsWith('/posts/')) {
      const slug = p.path.replace('/posts/', '').replace(/\/$/, '');
      postViews[slug] = p.views;
    }
  }

  const postReactions = {};
  for (const r of reactions) {
    const pid = r.post_id;
    if (pid) postReactions[pid] = (postReactions[pid] || 0) + 1;
  }
  const postComments = {};
  for (const c of comments) {
    const pid = c.post_id;
    if (pid) postComments[pid] = (postComments[pid] || 0) + 1;
  }

  return posts.map((post) => {
    const views = postViews[post.slug] || 0;
    const reacts = postReactions[post.id] || 0;
    const commentsCount = postComments[post.id] || 0;
    // 综合评分：浏览量权重 50%，反应(×5) + 评论(×10) 权重 50%
    const engagement = reacts + commentsCount * 2;
    const score = views * 0.5 + (reacts * 5 + commentsCount * 10) * 0.5;
    return { post, views, reacts, comments: commentsCount, score, engagement };
  }).sort((a, b) => b.score - a.score);
}

function generateReport(scored, stats) {
  const top = scored.filter((s) => s.score > 0).slice(0, 10);
  const highEngagement = scored.filter((s) => s.engagement >= 5).sort((a, b) => b.engagement - a.engagement);
  const totalViews = stats?.totalViews || 0;
  const uniqueVisitors = stats?.uniqueVisitors || 0;

  return `# 数字产品建议书

> 生成时间：${new Date().toISOString()}
> 数据源：/api/blog-stats + reactions + comments

## 📊 流量概览

- 近 30 天总浏览量：${totalViews}
- 独立访客：${uniqueVisitors}

## 🏆 高价值内容 TOP 10

| 排名 | 文章 | 浏览 | 反应 | 评论 | 综合分 |
|------|------|------|------|------|--------|
${top.map((s, i) => `| ${i + 1} | ${s.post.title} | ${s.views} | ${s.reacts} | ${s.comments} | ${s.score.toFixed(1)} |`).join('\n')}

## 💡 数字产品孵化建议

${top.slice(0, 3).map((s, i) => `
### 方向 ${i + 1}：基于《${s.post.title}》

**内容基础**：
- 浏览量：${s.views} 次
- 互动量：${s.reacts} 反应 + ${s.comments} 评论
- 综合评分：${s.score.toFixed(1)}

**建议产品形态**：
- 📖 系列专栏：将主题扩展为 5-10 篇系列文章
- 🎥 视频教程：将文字内容转为代码实操视频
- 📦 开源项目：围绕文章技术栈创建可复用的工具/模板
- 💰 付费电子书：深度扩展为结构化电子书

**预估工时**：20-40 小时
**收益模型**：先免费引流 -> 积累订阅 -> 推出付费深度版
`).join('\n')}

## 📈 互动热点（可重点运营）

${highEngagement.slice(0, 5).map((s) => `- ${s.post.title}（${s.reacts} 反应 + ${s.comments} 评论）`).join('\n') || '暂无高互动内容'}

## 📊 内容健康度

- 已发布文章：${scored.length} 篇
- 有浏览数据：${scored.filter((s) => s.views > 0).length} 篇
- 有互动：${scored.filter((s) => s.engagement > 0).length} 篇
- 零流量文章：${scored.filter((s) => s.views === 0).length} 篇（建议检查内部链接与 SEO）

---
*此报告由 content-value-analysis 脚本自动生成，数据仅供博主决策参考。*
`;
}

async function main() {
  console.log('=== 高价值内容识别 ===\n');

  const [stats, reactions, comments, posts] = await Promise.all([
    fetchBlogStats(),
    fetchCollection('reactions'),
    fetchCollection('comments', 'status = "approved"'),
    fetchPosts(),
  ]);

  console.log(`数据量：${stats?.totalViews || 0} 浏览 / ${reactions.length} 反应 / ${comments.length} 评论 / ${posts.length} 文章`);

  if (!posts.length) {
    console.log('⚠️ 无文章数据');
    return;
  }

  const scored = computeValueScore(stats, reactions, comments, posts);
  const report = generateReport(scored, stats);

  mkdirSync(REPORT_DIR, { recursive: true });
  const reportPath = join(REPORT_DIR, 'content-value-report.md');
  writeFileSync(reportPath, report, 'utf-8');

  console.log(`\n✅ 报告已生成: ${reportPath}`);
}

main().catch(console.error);
