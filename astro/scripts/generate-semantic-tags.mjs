#!/usr/bin/env node
/**
 * 语义标签自动生成脚本 —— 构建时分析 Markdown/HTML 内容，提取关键词作为标签。
 *
 * 展示层归类：⚙️ 后台基建层（构建时执行，不打包进前端 Bundle）
 * 无 DOM 操作、无浏览器 API 调用
 * 输出：写入 PocketBase settings 表或 frontmatter
 *
 * 用法：node scripts/generate-semantic-tags.mjs
 * 分支名：infra/semantic-tags
 *
 * 算法：TF-IDF 简化版 + 技术关键词词典匹配
 * 依赖：无外部依赖（纯 Node.js）
 */

import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PB_URL = process.env.PUBLIC_POCKETBASE_URL || 'http://localhost:8090';
const DIST_DIR = join(process.cwd(), 'dist');

// 技术关键词词典（用于优先匹配）
const TECH_KEYWORDS = [
  'Astro', 'React', 'TypeScript', 'JavaScript', 'PocketBase', 'Docker',
  'Caddy', 'TailwindCSS', 'Node.js', 'SSG', 'PWA', 'WebAuthn',
  'Security', 'XSS', 'CSP', 'SQL注入', '性能优化', 'SEO',
  'Framer Motion', 'Three.js', 'Pagefind', 'SQLite', 'RBAC',
];

// 停用词
const STOP_WORDS = new Set([
  '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一',
  '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有',
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'to', 'of', 'in', 'on', 'for',
  'with', 'and', 'or', 'not', 'this', 'that', 'it', 'as', 'be',
]);

function collectHtmlFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'pagefind' && entry.name !== '_astro') {
      files.push(...collectHtmlFiles(path));
    } else if (entry.name.endsWith('.html')) {
      files.push(path);
    }
  }
  return files;
}

function extractText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  // 英文词
  const enWords = (text.match(/[a-zA-Z][a-zA-Z0-9.+-]{2,}/g) || [])
    .map((w) => w.toLowerCase())
    .filter((w) => !STOP_WORDS.has(w));
  // 中文 2-4 字词组（简易分词）
  const cnWords = text.match(/[\u4e00-\u9fa5]{2,4}/g) || [];
  return [...enWords, ...cnWords];
}

function computeTf(tokens) {
  const tf = {};
  for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
  const total = tokens.length || 1;
  for (const t in tf) tf[t] /= total;
  return tf;
}

function generateTags(html, title) {
  const text = extractText(html);
  const tokens = tokenize(text);
  const tf = computeTf(tokens);

  // 1. 词典匹配（优先级最高）
  const matched = TECH_KEYWORDS.filter((kw) =>
    text.toLowerCase().includes(kw.toLowerCase())
  );

  // 2. TF 前 10
  const topTf = Object.entries(tf)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);

  // 合并去重，最多 8 个
  const tags = [...new Set([...matched, ...topTf])].slice(0, 8);
  return tags;
}

async function main() {
  if (!existsSync(DIST_DIR)) {
    console.error('❌ dist/ 不存在，请先 npm run build');
    process.exit(1);
  }

  console.log('=== 语义标签生成 ===\n');
  const files = collectHtmlFiles(DIST_DIR);
  console.log(`扫描到 ${files.length} 个 HTML 文件\n`);

  const results = [];
  for (const file of files) {
    const html = readFileSync(file, 'utf-8');
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    const title = titleMatch ? titleMatch[1].split('|')[0].trim() : '';
    const tags = generateTags(html, title);

    if (tags.length) {
      results.push({ file: file.replace(DIST_DIR, ''), title, tags });
      console.log(`📄 ${title}`);
      console.log(`   标签: ${tags.join(', ')}\n`);
    }
  }

  // 输出 JSON 报告（供博主审阅，不自动写入数据库）
  const reportPath = join(process.cwd(), 'tmp', 'semantic-tags-report.json');
  writeFileSync(reportPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\n✅ 报告已生成: ${reportPath}`);
  console.log('   审阅后可通过 PocketBase Admin UI 手动添加标签');
}

main().catch(console.error);
