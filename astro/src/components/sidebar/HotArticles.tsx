import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { getPocketBase } from '../../lib/pocketbase';
import type { Post } from '../../types/pocketbase';

export default function HotArticles() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const pb = getPocketBase();
    pb.collection('posts')
      .getList<Post>(1, 5, { filter: 'status = "published"', sort: '-views', fields: 'id,title,slug,cover,views,created' })
      .then((res) => setPosts(res.items))
      .catch((err) => console.error('加载热榜失败:', err))
      .finally(() => setLoading(false));
  }, []);

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2 }} className="widget">
      <div className="widget-title">热榜文章</div>
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-bg-soft" />)}
        </div>
      ) : (
        <div className="space-y-3">
          {posts.length === 0 ? (
            <p className="text-sm text-text-secondary">暂无热门文章</p>
          ) : (
            posts.map((post, index) => (
              <a key={post.id} href={`/posts/${post.slug}`} className="group flex items-start gap-3">
                <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md text-xs font-bold ${index < 3 ? 'bg-accent text-white' : 'bg-bg-soft text-text-muted'}`}>{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-medium text-text transition-colors group-hover:text-accent">{post.title}</p>
                  <p className="mt-0.5 text-xs text-text-muted">{post.views || 0} 人已阅读</p>
                </div>
              </a>
            ))
          )}
        </div>
      )}
    </motion.div>
  );
}
