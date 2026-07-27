import { useState, useEffect } from 'react';
import { postService } from '../../lib/services/postService';
import type { Post } from '../../types/pocketbase';

/**
 * 侧边栏热门文章 Hook
 */
export function useHotPosts(limit: number = 5) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    postService.getHotPosts(limit)
      .then(setPosts)
      .catch((err) => console.error('加载热榜失败:', err))
      .finally(() => setLoading(false));
  }, [limit]);

  return { posts, loading };
}
