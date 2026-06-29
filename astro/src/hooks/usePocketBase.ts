import { useCallback, useEffect, useState } from 'react';
import { getPocketBase } from '../lib/pocketbase';
import { normalizeAuthEmail, withAuthRequestHeaders } from '../lib/security';
import type { Post, PublicComment, ReaderRegisterData, User } from '../types/pocketbase';

export function usePocketBase() {
  const pb = getPocketBase();

  return {
    pb,

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
    }, [pb]),

    getPost: useCallback(async (slug: string) => {
      try {
        const result = await pb.collection('posts').getFirstListItem<Post>(
          pb.filter('slug = {:slug} && status = {:status}', { slug, status: 'published' }),
          { expand: 'author' }
        );
        return { data: result, error: null };
      } catch (err) {
        console.error('获取文章失败:', err);
        return { data: null, error: err };
      }
    }, [pb]),

    getComments: useCallback(async (postId: string) => {
      try {
        const result = await pb.collection('public_comments').getFullList<PublicComment>({
          filter: pb.filter('post_id = {:postId}', { postId }),
          sort: '-created',
          fields: 'id,post_id,author_name,content,parent_id,status,created,updated',
        });
        return { data: result, error: null };
      } catch (err) {
        console.error('获取评论失败:', err);
        return { data: null, error: err };
      }
    }, [pb]),

    requestOTP: useCallback(async (email: string) => {
      try {
        const result = await withAuthRequestHeaders(pb, () => pb.collection('users').requestOTP(normalizeAuthEmail(email)));
        return { data: result, error: null };
      } catch (err) {
        console.error('发送 OTP 验证码失败:', err);
        return { data: null, error: err };
      }
    }, [pb]),

        authWithOTP: useCallback(async (otpId: string, code: string) => {
      try {
        const result = await withAuthRequestHeaders(pb, () => pb.collection('users').authWithOTP<User>(otpId, code));
        const role = result.record?.role;

        if (role === 'author' || role === 'admin' || role === 'super_admin') {
          pb.authStore.clear();
          return { success: false, data: null, error: new Error('高权限账户请使用密码登录，并在密码校验后完成二次验证。') };
        }

        return { success: true, data: result, error: null };
      } catch (err) {
        console.error('OTP login failed:', err);
        return { success: false, data: null, error: err };
      }
    }, [pb]),

    registerReader: useCallback(async (data: Omit<ReaderRegisterData, 'role'>) => {
      try {
        const payload: ReaderRegisterData = { ...data, email: normalizeAuthEmail(data.email), role: 'reader' };
        const record = await withAuthRequestHeaders(pb, () => pb.collection('users').create<User>(payload));
        const auth = await withAuthRequestHeaders(pb, () => pb.collection('users').authWithPassword<User>(payload.email, data.password));
        return { success: true, data: { record, auth }, error: null };
      } catch (err) {
        console.error('注册 reader 用户失败:', err);
        return { success: false, data: null, error: err };
      }
    }, [pb]),
  };
}

export function usePosts(page = 1, perPage = 10) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    const pb = getPocketBase();

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
