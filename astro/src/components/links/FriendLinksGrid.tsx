import React from 'react';
import { motion } from 'framer-motion';
import { useFriendLinks } from '../../hooks/domains/useFriendLinks';
import { trackLinkClick } from '../../lib/track';
import { fadeUp, staggerContainer } from '../../lib/motion';

function isSafeLinkUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * 友链卡片网格：头像/首字母 + 名称 + 简介 + 域名；点击上报后新标签打开。
 *
 * 科幻简约：细线表面 + 小圆角，深浅主题由 `.dark` 覆写 `--sf-*` 令牌；
 * 外链 hover 只换描边与文字色（不放大、不发光、不加阴影），缩略图统一方角细线。
 */
export default function FriendLinksGrid() {
  const { links, loading } = useFriendLinks();

  const visibleLinks = links.filter((i) => i.status === 'show' && isSafeLinkUrl(i.url));

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-4"
            aria-hidden="true"
          >
            <div className="flex items-start gap-3">
              <div className="skeleton h-10 w-10 shrink-0 rounded-[2px]" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="skeleton h-3.5 w-24 rounded-[2px]" />
                <div className="skeleton h-3 w-full rounded-[2px]" />
                <div className="skeleton h-3 w-16 rounded-[2px]" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (visibleLinks.length === 0) {
    return (
      <div className="rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-10 text-center text-sm text-[var(--sf-ink-3)]">
        暂无友链，欢迎通过下方邮箱申请互换。
      </div>
    );
  }

  return (
    <motion.div variants={staggerContainer(0.06)} initial="hidden" animate="visible" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {visibleLinks.map((link) => (
        <motion.a
          key={link.id}
          variants={fadeUp}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => trackLinkClick(link.url)}
          className="group focus-ring flex items-start gap-3 rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-4 no-underline transition-colors duration-200 hover:border-[var(--sf-accent)]"
        >
          {link.avatar ? (
            <img
              src={link.avatar}
              alt=""
              loading="lazy"
              className="h-10 w-10 shrink-0 rounded-[2px] border border-[var(--sf-line)] object-cover"
            />
          ) : (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[2px] border border-[var(--sf-line)] bg-[var(--sf-canvas)] font-mono text-sm font-semibold text-[var(--sf-ink-2)]">
              {link.name.charAt(0)}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-[var(--sf-ink)] transition-colors group-hover:text-[var(--sf-accent-ink)]">
              {link.name}
            </span>
            {link.description && (
              <span className="mt-0.5 block truncate text-xs text-[var(--sf-ink-3)]">{link.description}</span>
            )}
            <span className="mt-1 block truncate font-mono text-[11px] text-[var(--sf-ink-3)]">{hostname(link.url)}</span>
          </span>
        </motion.a>
      ))}
    </motion.div>
  );
}
