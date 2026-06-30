import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getPocketBase } from '../../lib/pocketbase';
import type { Announcement } from '../../types/pocketbase';
import { cn } from '../../lib/utils';

const typeStyles: Record<string, string> = {
  info: 'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:border-sky-900',
  warning: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900',
  important: 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-900',
  normal: 'bg-stone-100 text-stone-700 border-stone-200 dark:bg-stone-900/60 dark:text-stone-300 dark:border-stone-800',
};

export default function AnnouncementBar() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [closed, setClosed] = useState<Set<string>>(new Set());

  useEffect(() => {
    const pb = getPocketBase();
    pb.collection('announcements').getList<Announcement>(1, 3, { sort: '-created' })
      .then(r => setAnnouncements(r.items))
      .catch(() => {});
  }, []);

  if (announcements.length === 0) return null;

  return (
    <AnimatePresence>
      {announcements.filter(a => !closed.has(a.id)).map(a => (
        <motion.div
          key={a.id}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, height: 0 }}
          className={cn('border-b px-4 py-2.5 text-center text-sm', typeStyles[a.type] || typeStyles.normal)}
        >
          <div className="mx-auto flex max-w-4xl items-center justify-center gap-3">
            <span className="min-w-0">
              {a.title && <span className="font-semibold">{a.title}：</span>}
              <span>{a.content}</span>
            </span>
            <button
              onClick={() => setClosed(prev => new Set([...prev, a.id]))}
              className="shrink-0 rounded p-1 opacity-70 transition-opacity hover:opacity-100"
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
