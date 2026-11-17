import React from 'react';
import { motion } from 'framer-motion';
import { useSidebarFriendLinks } from '../../hooks/domains/useSidebarFriendLinks';

/**
 * 首页友链块：保留 useSidebarFriendLinks(20) 真实数据与加载/空态行为，
 * 只把旧的青绿/锌灰胶囊样式换成 --sf-* 令牌（细线 + 3px 圆角 + 等宽短标签）。
 */

const HEADING_CLASS = 'text-sm font-semibold tracking-[0.05em] text-[var(--sf-ink)]';
const COUNTER_CLASS = 'font-mono text-[0.625rem] uppercase tracking-[0.18em] text-[var(--sf-ink-3)]';
const LINK_CLASS =
  'inline-flex min-h-[44px] max-w-full items-center break-words rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-canvas)] px-3.5 text-sm text-[var(--sf-ink-2)] no-underline transition-colors hover:border-[var(--sf-accent)] hover:text-[var(--sf-accent-ink)]';

export default function FriendLinks() {
  const { links, loading } = useSidebarFriendLinks(20);

  if (loading) return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="min-w-0">
      <div className="mb-3 flex items-baseline justify-between border-b border-[var(--sf-line-soft)] pb-2">
        <h3 className={HEADING_CLASS}>友情链接</h3>
        <span className={COUNTER_CLASS}>LINKS / 20</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-10 w-20 animate-pulse rounded-[3px] bg-[var(--sf-line-soft)]" />
        ))}
      </div>
    </motion.div>
  );
  if (links.length === 0) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.4 }} className="min-w-0">
      <div className="mb-3 flex items-baseline justify-between border-b border-[var(--sf-line-soft)] pb-2">
        <h3 className={HEADING_CLASS}>友情链接</h3>
        <span className={COUNTER_CLASS}>LINKS / {String(links.length).padStart(2, '0')}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {links.map((link) => (
          <a key={link.id} href={link.url} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
            {link.name}
          </a>
        ))}
      </div>
    </motion.div>
  );
}
