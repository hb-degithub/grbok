import type { APIRoute } from 'astro';
import { cachedFetchJson } from '../lib/pb-cache';
import { pbBaseUrl } from '../lib/pb-base-url';

interface PBPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  published_at: string;
  updated: string;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export const GET: APIRoute = async ({ site }) => {
  const siteUrl = (site?.toString() || 'http://localhost:4321').replace(/\/$/, '');
  // SSR 取数走服务端回环地址，浏览器侧仍用公网域名（见 pb-base-url.ts）
  const pbUrl = pbBaseUrl();

  // Fetch published posts from PocketBase（60s 进程缓存，RSS 阅读器轮询不再穿透到 PB）
  let posts: PBPost[] = [];
  try {
    const data = await cachedFetchJson<{ items?: PBPost[] }>(
      `${pbUrl}/api/collections/posts/records?filter=(status='published')&sort=-published_at&fields=id,title,slug,excerpt,published_at,updated&perPage=50`,
      undefined,
      60_000,
    );
    posts = data.items || [];
  } catch {
    // If PocketBase is unreachable, return feed with no items
  }

  const items = posts
    .map((post) => {
      const postUrl = `${siteUrl}/posts/${post.slug}`;
      const pubDate = post.published_at
        ? new Date(post.published_at).toUTCString()
        : new Date(post.updated || Date.now()).toUTCString();
      const description = post.excerpt
        ? escapeXml(post.excerpt)
        : escapeXml((post.content || '').slice(0, 200));

      return `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${postUrl}</link>
      <description>${description}</description>
      <pubDate>${pubDate}</pubDate>
      <guid isPermaLink="true">${postUrl}</guid>
    </item>`;
    })
    .join('\n');

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>胡巴的博客</title>
    <link>${siteUrl}/</link>
    <description>胡巴的个人博客，记录技术、思考与生活。</description>
    <language>zh-CN</language>
    <atom:link href="${siteUrl}/feed.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>`;

  return new Response(rss, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
