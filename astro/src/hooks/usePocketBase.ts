import { useCallback, useEffect, useState } from 'react';
import { postService } from '../lib/services/postService';
import { commentService } from '../lib/services/commentService';
import { runAfterAdminCredentialRevoked } from '../lib/admin-auth-lifecycle';
import { clearAdminStepUp } from '../lib/admin-step-up';
import { registerReader as registerReaderRequest, requestReaderOtp, requestVerification as requestVerificationRequest, verifyReaderOtp } from '../lib/blog-auth-client';
import { authService } from '../lib/services/authService';
import type { Post, ReaderRegisterData } from '../types/pocketbase';

/**
 * @deprecated 请使用领域特定的 Hooks，如 usePosts、useComments 等
 * 此 Hook 保留用于向后兼容，新代码应使用 Service 层和领域 Hooks
 */
export function usePocketBase() {
  const pb = authService.getPocketBase();

  return {
    pb,

    getPosts: useCallback(async (page = 1, perPage = 10) => {
      try {
        const result = await postService.getPublishedPosts(page, perPage);
        return { data: result, error: null };
      } catch (err) {
        console.error('获取文章列表失败:', err);
        return { data: null, error: err };
      }
    }, []),

    getPost: useCallback(async (slug: string) => {
      try {
        const result = await postService.getFirstListItem(
          pb.filter('slug = {:slug} && status = "published"', { slug }),
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
        const result = await commentService.getPublicComments(postId);
        return { data: result, error: null };
      } catch (err) {
        console.error('获取评论失败:', err);
        return { data: null, error: err };
      }
    }, []),

    requestOTP: useCallback(async (email: string) => {
      try {
        const result = await requestReaderOtp(email);
        return { data: { otpId: result.challengeId }, error: null };
      } catch (err) {
        console.error('发送 OTP 验证码失败:', err);
        return { data: null, error: err };
      }
    }, []),

    authWithOTP: useCallback(async (otpId: string, code: string) => {
      try {
        const result = await runAfterAdminCredentialRevoked(
          pb,
          () => clearAdminStepUp({ includeClientSession: true }),
          () => verifyReaderOtp(otpId, code),
        );
        // 所有角色均可通过 OTP 登录；admin/super_admin 进入后台时由 AdminGuard 强制 TOTP 二次验证
        return { success: true, data: result, error: null };
      } catch (err) {
        console.error('OTP login failed:', err);
        return { success: false, data: null, error: err };
      }
    }, [pb]),

    registerReader: useCallback(async (data: Omit<ReaderRegisterData, 'role'>) => {
      try {
        const accepted = await registerReaderRequest(data);
        return { success: true, data: accepted, error: null };
      } catch (err) {
        console.error('注册 reader 用户失败:', err);
        return { success: false, data: null, error: err };
      }
    }, []),

    requestVerification: useCallback(async (email: string) => {
      try {
        await requestVerificationRequest(email);
        return { success: true, error: null };
      } catch (err) {
        console.error('发送验证邮件失败:', err);
        return { success: false, error: err };
      }
    }, []),
  };
}

export function usePosts(page = 1, perPage = 10, tagSlug?: string) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    const pb = authService.getPocketBase();

    const fetchPosts = async () => {
      setLoading(true);
      try {
        let filter = 'status = "published"';

        if (tagSlug) {
          const tagRes = await pb.collection('tags').getList(1, 1, {
            filter: pb.filter('slug = {:slug}', { slug: tagSlug }),
          });
          const tag = tagRes.items[0];
          if (!tag) {
            setPosts([]);
            setTotalPages(1);
            return;
          }
          const ptRes = await pb.collection('post_tags').getFullList({
            filter: pb.filter('tag_id = {:tagId}', { tagId: tag.id }),
            fields: 'post_id',
          });
          const postIds = ptRes.map((pt) => (pt as unknown as { post_id: string }).post_id);
          if (postIds.length === 0) {
            setPosts([]);
            setTotalPages(1);
            return;
          }
          filter += pb.filter(' && id in {:postIds}', { postIds: postIds.join(',') });
        }

        const result = await pb.collection('posts').getList<Post>(page, perPage, {
          filter,
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
  }, [page, perPage, tagSlug]);

  return { posts, loading, error, totalPages };
}
