#!/usr/bin/env node
// 本地 mock OpenAI 兼容端点，用于 AI 功能的端到端验证（不消耗真实 API 额度）。
//
// 用法：
//   node scripts/mock-llm-server.mjs            # 默认 127.0.0.1:4399
//   MOCK_PORT=4400 node scripts/mock-llm-server.mjs
//   MOCK_API_KEY=xxx                            # 校验 Bearer（默认 test-key）
//   MOCK_DELAY_MS=2000                          # 模拟上游延迟
//   MOCK_FAIL=429|500                           # 模拟上游故障
//
// 行为（按 prompt 启发式路由）：
//   user 含 'ping'                → 'pong'（连通性测试）
//   prompt 要求 verdict JSON      → 审核判定；评论内容含 __spam__ → spam，
//                                   含 __unsure__ → unsure，否则 approve
//   prompt 要求 title/content JSON → 文章 JSON（HTML 正文）
//   prompt 要求 titles JSON       → 元信息 JSON
//   system/user 含 '润色'          → 润色文本
//   system/user 含 '续写'          → 续写文本
//   其他                          → 通用回复文本（评论回复）

import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 4399);
const API_KEY = process.env.MOCK_API_KEY || 'test-key';
const DELAY_MS = Number(process.env.MOCK_DELAY_MS || 0);
const FAIL = process.env.MOCK_FAIL || '';

function reply(kind, messages) {
  const joined = messages.map((m) => String(m.content || '')).join('\n');

  if (/\bping\b/i.test(joined)) return 'pong';

  // 审核判定：prompt 会要求输出 {"verdict": ...}
  if (joined.includes('"verdict"')) {
    let verdict = 'approve';
    let reason = '内容正常，mock 判定通过';
    if (joined.includes('__spam__')) { verdict = 'spam'; reason = 'mock 检测到广告特征'; }
    else if (joined.includes('__unsure__')) { verdict = 'unsure'; reason = 'mock 拿不准，转人工'; }
    return JSON.stringify({ verdict, reason });
  }

  // 文章全文：prompt 会要求 {"title": ..., "content": ...}
  if (joined.includes('"title"') && joined.includes('"content"')) {
    return JSON.stringify({
      title: 'Mock 生成：AI 辅助写作实践',
      slug_hint: 'ai-assisted-writing-mock',
      excerpt: '这是一篇由 mock LLM 生成的测试文章摘要。',
      content: '<h2>引言</h2><p>这是 mock 生成的正文第一段。</p><h2>正文</h2><p>这是 mock 生成的正文第二段，包含 <strong>加粗</strong> 与代码：</p><pre><code>console.log("mock");</code></pre><h2>总结</h2><p>mock 生成的结尾。</p>',
      seo_description: 'mock 生成的 SEO 描述',
      tag_names: ['AI', '测试'],
    });
  }

  // 元信息：prompt 会要求 {"titles": ...}
  if (joined.includes('"titles"')) {
    return JSON.stringify({
      titles: ['Mock 候选标题一', 'Mock 候选标题二', 'Mock 候选标题三'],
      excerpt: 'mock 生成的摘要',
      tag_names: ['AI', '前端'],
      seo_description: 'mock 生成的 SEO 描述',
    });
  }

  if (joined.includes('润色')) return '【mock 润色后】表达更流畅的文本。';
  if (joined.includes('续写')) return '【mock 续写】这是接着上文生成的内容。';

  // 默认：评论回复
  return '感谢你的评论！这是一条 mock AI 回复。';
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
    return;
  }
  if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
    res.writeHead(404).end('not found');
    return;
  }
  if (req.headers.authorization !== `Bearer ${API_KEY}`) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end('{"error":{"message":"invalid api key"}}');
    return;
  }
  if (FAIL) {
    res.writeHead(Number(FAIL), { 'Content-Type': 'application/json' });
    res.end('{"error":{"message":"mock failure"}}');
    return;
  }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let messages = [];
    try { messages = JSON.parse(body).messages || []; } catch { /* ignore */ }
    const content = reply('chat', messages);
    const payload = JSON.stringify({
      id: 'chatcmpl-mock',
      object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    });
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(payload);
    }, DELAY_MS);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-llm] listening on http://127.0.0.1:${PORT} (key=${API_KEY})`);
});
