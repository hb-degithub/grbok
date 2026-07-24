#!/usr/bin/env node
/**
 * LLM 摘要生成脚本 —— 构建时为文章生成 AI 摘要，存入元数据。
 *
 * 展示层归类：⚙️ 后台基建层（构建时执行，不打包进前端 Bundle）
 * 无 DOM 操作、无浏览器 API 调用
 *
 * 用法：node scripts/generate-summaries.mjs
 * 分支名：infra/llm-summaries
 *
 * 模型支持：OpenAI / 阿里云通义千问 / 本地 Ollama（通过 LLM_PROVIDER 环境变量切换）
 * 依赖：无外部依赖（用 Node.js 内置 fetch）
 *
 * 环境变量：
 *   LLM_PROVIDER=openai|qwen|ollama (默认 ollama)
 *   LLM_API_KEY=your_key
 *   LLM_BASE_URL=http://localhost:11434 (Ollama)
 *   LLM_MODEL=qwen2.5:7b (默认)
 */

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const DIST_DIR = join(process.cwd(), 'dist');
const REPORT_DIR = join(process.cwd(), 'tmp');

const PROVIDER = process.env.LLM_PROVIDER || 'ollama';
const API_KEY = process.env.LLM_API_KEY || '';
const BASE_URL = process.env.LLM_BASE_URL || 'http://localhost:11434';
const MODEL = process.env.LLM_MODEL || 'qwen2.5:7b';

const SYSTEM_PROMPT = `你是一个技术博客摘要生成器。请为以下文章生成一段 100-150 字的中文摘要，要求：
1. 概括文章核心主题和关键结论
2. 不使用"本文介绍了"等套话
3. 保持客观陈述风格
4. 只输出摘要文本，不加任何前缀`;

function collectPostHtml(dir) {
  const files = [];
  const postsDir = join(dir, 'posts');
  if (!existsSync(postsDir)) return files;
  for (const entry of readdirSync(postsDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const subDir = join(postsDir, entry.name);
      for (const f of readdirSync(subDir)) {
        if (f.endsWith('.html')) files.push(join(subDir, f));
      }
    } else if (entry.name.endsWith('.html')) {
      files.push(join(postsDir, entry.name));
    }
  }
  return files;
}

function extractArticleText(html) {
  // 提取 <article> 标签内容（取最后一个 </article> 以防嵌套），若无则取 <main>
  const lastClose = html.lastIndexOf('</article>');
  if (lastClose !== -1) {
    const firstOpen = html.indexOf('<article');
    if (firstOpen !== -1 && firstOpen < lastClose) {
      const content = html.slice(firstOpen, lastClose);
      // 去掉开头的 <article...> 标签本身
      const tagEnd = content.indexOf('>') + 1;
      return content.slice(tagEnd)
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&[a-z]+;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 4000);
    }
  }
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000);
}

async function generateSummary(text) {
  const endpoints = {
    openai: `${BASE_URL}/v1/chat/completions`,
    qwen: `${BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode'}/v1/chat/completions`,
    ollama: `${BASE_URL}/api/chat`,
  };

  const url = endpoints[PROVIDER] || endpoints.ollama;
  const body =
    PROVIDER === 'ollama'
      ? JSON.stringify({
          model: MODEL,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: text },
          ],
          stream: false,
          options: { temperature: 0.3 },
        })
      : JSON.stringify({
          model: MODEL,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: text },
          ],
          temperature: 0.3,
          max_tokens: 300,
        });

  const headers = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`;

  const res = await fetch(url, { method: 'POST', headers, body });
  if (!res.ok) throw new Error(`LLM API 返回 ${res.status}: ${await res.text()}`);

  const data = await res.json();
  // OpenAI/Qwen 格式
  if (data.choices?.[0]?.message?.content) {
    return data.choices[0].message.content.trim();
  }
  // Ollama 格式
  if (data.message?.content) {
    return data.message.content.trim();
  }
  throw new Error('LLM 响应格式无法解析');
}

async function main() {
  if (!existsSync(DIST_DIR)) {
    console.error('❌ dist/ 不存在，请先 npm run build');
    process.exit(1);
  }

  console.log(`=== LLM 摘要生成 (provider: ${PROVIDER}, model: ${MODEL}) ===\n`);

  const files = collectPostHtml(DIST_DIR);
  if (!files.length) {
    console.log('未找到文章页面');
    return;
  }

  console.log(`发现 ${files.length} 篇文章\n`);

  mkdirSync(REPORT_DIR, { recursive: true });
  const results = [];

  for (const file of files) {
    const html = readFileSync(file, 'utf-8');
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    const title = titleMatch ? titleMatch[1].split('|')[0].trim() : file;
    const text = extractArticleText(html);

    if (text.length < 100) {
      console.log(`⏭️  ${title} (内容过短，跳过)`);
      continue;
    }

    console.log(`📝 生成摘要: ${title}`);
    try {
      const summary = await generateSummary(text);
      results.push({ file: file.replace(DIST_DIR, ''), title, summary });
      console.log(`   → ${summary.slice(0, 60)}...\n`);
    } catch (err) {
      console.warn(`   ❌ 失败: ${err instanceof Error ? err.message : err}\n`);
      results.push({ file: file.replace(DIST_DIR, ''), title, summary: null, error: String(err) });
    }

    // 请求间隔，避免限流
    await new Promise((r) => setTimeout(r, 1000));
  }

  const reportPath = join(REPORT_DIR, 'llm-summaries-report.json');
  writeFileSync(reportPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\n✅ 报告已生成: ${reportPath}`);
  console.log('   审阅后可手动写入文章的 excerpt 字段');
}

main().catch(console.error);
