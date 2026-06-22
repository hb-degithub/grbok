import { useState, useEffect, useCallback } from 'react';
import { pb } from '../lib/pocketbase';
import type { Post, User, Comment, Tag } from '../types/pocketbase';

/**
 * PocketBase React Hook
 * 提供常用的数据获取方法，支持加载状态和错误处理
 */
export function usePocketBase() {
  return {
    pb,
    /**
     * 获取已发布的文章列表
     */
    getPosts: useCallback(async (page = 1, perPage = 10) => {
      try {
        const result = await pb.collection('posts').getList<Post>(page, perPage, {
          filter: 'status = "published"',
          sort: '-published_at',
          expand: 'author',
        });
        return { data: result, error: null };
      } catch (err) {
        console.error('获取文章列表失败:', err);
        return { data: null, error: err };
      }
    }, []),

    /**
     * 获取单篇文章
     */
    getPost: useCallback(async (slug: string) => {
      try {
        const result = await pb.collection('posts').getFirstListItem<Post>(
          `slug = "${slug}" && status = "published"`,
          { expand: 'author' }
        );
        return { data: result, error: null };
      } catch (err) {
        console.error('获取文章失败:', err);
        return { data: null, error: err };
      }
    }, []),

    /**
     * 获取文章的评论列表
     */
    getComments: useCallback(async (postId: string) => {
      try {
        const result = await pb.collection('comments').getFullList<Comment>({
          filter: `post_id = "${postId}" && status = "approved"`,
          sort: '-created',
        });
        return { data: result, error: null };
      } catch (err) {
        console.error('获取评论失败:', err);
        return { data: null, error: err };
      }
    }, []),

    /**
     * 用户登录（Magic Link）
     */
    requestMagicLink: useCallback(async (email: string) => {
      try {
        await pb.collection('users').requestVerification(email);
        return { success: true, error: null };
      } catch (err) {
        console.error('发送 Magic Link 失败:', err);
        return { success: false, error: err };
      }
    }, []),

    /**
     * 验证 Magic Link
     */
    verifyMagicLink: useCallback(async (token: string) => {
      try {
        const result = await pb.collection('users').confirmVerification(token);
        return { success: true, data: result, error: null };
      } catch (err) {
        console.error('验证 Magic Link 失败:', err);
        return { success: false, data: null, error: err };
      }
    }, []),
  };
}

/**
 * 文章列表 Hook
 */
export function usePosts(page = 1, perPage = 10) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    const fetchPosts = async () => {
      setLoading(true);
      try {
        const result = await pb.collection('posts').getList<Post>(page, perPage, {
          filter: 'status = "published"',
          sort: '-published_at',
          expand: 'author',
        });
        setPosts(result.items);
        setTotalPages(result.totalPages);
      } catch (err) {
        setError(err as Error);
      } finally {
        setLoading(false);
      }
    };

    fetchPosts();
  }, [page, perPage]);

  return { posts, loading, error, totalPages };
}
