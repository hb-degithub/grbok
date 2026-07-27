import React from 'react';
import { motion } from 'framer-motion';
import { useHotPosts } from '../../hooks/domains/useHotPosts';
import AnimatedList from '../reactbits/AnimatedList';

export default function HotArticles() {
  const { posts, loading } = useHotPosts(5);

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2 }} className="space-y-3">
      <div className="text-sm font-black tracking-tight text-zinc-950 dark:text-zinc-50">热榜文章</div>
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-zinc-50 dark:bg-zinc-900" />)}
        </div>
      ) : (
        <AnimatedList showGradients={false}>
          {posts.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">暂无热门文章</p>
          ) : (
            posts.map((post, index) => (
              <a key={post.id} href={`/posts/${post.slug}`} className="group flex items-start gap-3">
                <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md text-xs font-bold ${index < 3 ? 'bg-teal-500 text-white' : 'bg-zinc-50 dark:bg-zinc-900 text-zinc-400 dark:text-zinc-500'}`}>{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-medium text-zinc-900 dark:text-zinc-50 transition-colors group-hover:text-teal-600 dark:group-hover:text-teal-400">{post.title}</p>
                  <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">{post.views || 0} 人已阅读</p>
                </div>
              </a>
            ))
          )}
        </AnimatedList>
      )}
    </motion.div>
  );
}
