import React from 'react';
import { useFriendLinks } from '../../hooks/domains/useFriendLinks';

const MAX_LINKS = 10;

function isSafeLinkUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Footer 紧凑友链行：前 10 个文本链接 + 超出时「全部 →」跳 /links。
 * 无数据时不渲染（避免空标题）。
 */
export default function FooterFriendLinks() {
  const { links, loading } = useFriendLinks();

  if (loading) return null;

  const visibleLinks = links.filter((i) => i.status === 'show' && isSafeLinkUrl(i.url));

  if (visibleLinks.length === 0) return null;

  const shown = visibleLinks.slice(0, MAX_LINKS);
  const hasMore = visibleLinks.length > MAX_LINKS;

  return (
    <div className="mt-8 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-zinc-400 dark:text-zinc-500">
      <span className="shrink-0 font-semibold text-zinc-500 dark:text-zinc-400">友情链接：</span>
      {shown.map((link) => (
        <a
          key={link.id}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-teal-600 dark:hover:text-teal-400"
        >
          {link.name}
        </a>
      ))}
      {hasMore && (
        <a href="/links" className="font-semibold text-zinc-500 transition-colors hover:text-teal-600 dark:text-zinc-400 dark:hover:text-teal-400">
          全部 →
        </a>
      )}
    </div>
  );
}

