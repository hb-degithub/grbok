import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { getPocketBase } from '../../lib/pocketbase';
import type { Comment } from '../../types/pocketbase';

export default function RecentComments() {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const pb = getPocketBase();
    pb.collection('comments')
      .getList<Comment>(1, 5, { filter: 'status = "approved"', sort: '-created', fields: 'id,author_name,content,post_id,created' })
      .then((res) => setComments(res.items))
      .catch((err) => console.error('加载评论失败:', err))
      .finally(() => setLoading(false));
  }, []);

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.3 }} className="widget">
      <div className="widget-title">最近评论</div>
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-bg-soft" />)}
        </div>
      ) : (
        <div className="space-y-3">
          {comments.length === 0 ? (
            <p className="text-sm text-text-secondary">暂无评论</p>
          ) : (
            comments.map((comment) => (
              <div key={comment.id} className="flex items-start gap-3">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-bold text-accent">
                  {comment.author_name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-text">{comment.author_name}</p>
                  <p className="line-clamp-2 text-xs text-text-secondary">{comment.content}</p>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </motion.div>
  );
}
