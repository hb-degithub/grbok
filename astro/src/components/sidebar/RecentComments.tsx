import React from 'react';
import { motion } from 'framer-motion';
import { useRecentComments } from '../../hooks/domains/useRecentComments';
import { sanitizeText } from '../../lib/security';
import AnimatedList from '../reactbits/AnimatedList';

export default function RecentComments() {
  const { comments, loading } = useRecentComments(5);

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.3 }} className="space-y-3">
      <div className="text-sm font-black tracking-tight text-zinc-950 dark:text-zinc-50">最近评论</div>
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-zinc-50 dark:bg-zinc-900" />)}
        </div>
      ) : (
        <AnimatedList showGradients={false}>
          {comments.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">暂无评论</p>
          ) : (
            comments.map((comment) => (
              <div key={comment.id} className="flex items-start gap-3">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-teal-500/10 text-xs font-bold text-teal-600 dark:text-teal-400">
                  {comment.author_name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">{comment.author_name}</p>
                  <p className="line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">{sanitizeText(comment.content)}</p>
                </div>
              </div>
            ))
          )}
        </AnimatedList>
      )}
    </motion.div>
  );
}
