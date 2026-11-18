import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLatestAnnouncements } from '../../hooks/domains/useAnnouncements';
import { cn } from '../../lib/utils';
import type { Announcement } from '../../types/pocketbase';

/**
 * 公告类型配色
 *
 * 基底统一为表面色 + 1px 细线，类型差异只体现在细线/文字上：
 * info 用唯一强调色细线，warning 保留 amber 语义，important 用 --sf-danger 语义红，
 * normal 使用冷灰细线。不再使用 sky/rose/zinc 旧调色板与半透明底。
 */
const typeStyles: Record<string, string> = {
  info: 'border-[var(--sf-accent)] bg-[var(--sf-surface)] text-[var(--sf-ink-2)]',
  warning: 'border-amber-500 bg-amber-50 text-amber-900 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-100',
  important: 'border-[var(--sf-danger)] bg-[var(--sf-surface)] text-[var(--sf-danger)]',
  normal: 'border-[var(--sf-line)] bg-[var(--sf-surface)] text-[var(--sf-ink-2)]',
};

interface AnnouncementBarProps {
  /** 布局层 SSR 预取的公告；有值时首屏即渲染，避免把整页推下 80px 的布局位移。 */
  initialAnnouncements?: Announcement[] | null;
}

export default function AnnouncementBar({ initialAnnouncements }: AnnouncementBarProps = {}) {
  const { announcements } = useLatestAnnouncements(3, initialAnnouncements ?? null);
  const [closed, setClosed] = useState<Set<string>>(new Set());

  if (announcements.length === 0) return null;

  return (
    <AnimatePresence>
      {announcements.filter(a => !closed.has(a.id)).map(a => (
        <motion.div
          key={a.id}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, height: 0 }}
          // announcement-bar：公告根节点的稳定标识，供 BaseLayout 容器用
          // :has(.announcement-bar) 只在公告真实存在时预留顶部间距。
          className={cn('announcement-bar border-b px-4 py-2.5 text-center text-sm', typeStyles[a.type] || typeStyles.normal)}
        >
          <div className="mx-auto flex max-w-full sm:max-w-4xl items-center justify-center gap-3">
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap sm:whitespace-normal">
              {a.title && <span className="font-semibold">{a.title}：</span>}
              <span>{a.content}</span>
            </span>
            <button
              type="button"
              onClick={() => setClosed(prev => new Set([...prev, a.id]))}
              className="focus-ring shrink-0 rounded-[2px] p-2 opacity-70 transition-opacity hover:opacity-100 sm:p-1"
              aria-label="关闭公告"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </motion.div>
      ))}
    </AnimatePresence>
  );
}
