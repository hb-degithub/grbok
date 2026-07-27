import { useState, useEffect } from 'react';
import { commentSidebarService } from '../../lib/services/commentSidebarService';
import type { Comment } from '../../types/pocketbase';

/**
 * 侧边栏最近评论 Hook
 */
export function useRecentComments(limit: number = 5) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    commentSidebarService.getRecentApproved(limit)
      .then(setComments)
      .catch((err) => console.error('加载评论失败:', err))
      .finally(() => setLoading(false));
  }, [limit]);

  return { comments, loading };
}
