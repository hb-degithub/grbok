import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ site }) => {
  // RSS feed 在运行时生成，需要 PocketBase 服务可用
  // 构建时会跳过动态数据获取
  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>个人博客</title>
    <link>${site || 'http://localhost:4321'}</link>
    <description>我的个人博客</description>
    <language>zh-CN</language>
    <atom:link href="${site || 'http://localhost:4321'}/feed.xml" rel="self" type="application/rss+xml"/>
  </channel>
</rss>`;

  return new Response(rss, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
