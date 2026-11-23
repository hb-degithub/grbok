import { useCallback, useEffect, useRef, useState } from 'react';
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

    requestOTP: useCallback(async (email: string, altcha?: string) => {
      try {
        const result = await requestReaderOtp(email, altcha);
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

    requestVerification: useCallback(async (email: string, altcha?: string) => {
      try {
        await requestVerificationRequest(email, altcha);
        return { success: true, error: null };
      } catch (err) {
        console.error('发送验证邮件失败:', err);
        return { success: false, error: err };
      }
    }, []),
  };
}

export interface UsePostsResult {
  posts: Post[];
  loading: boolean;
  error: Error | null;
  totalPages: number;
  /** 重新拉取当前页（不刷新整页）；成功后清除 error。 */
  retry: () => void;
}

/**
 * 已发布文章列表。
 *
 * 阅读路径的分页/重试契约：
 * - `retry()` 走一次真实的重新取数（retryToken 自增触发 effect），不是整页 reload；
 * - 重新取数开始时清掉上一次的 error，成功后也显式 `setError(null)`，
 *   避免「重试已经成功、界面还停在失败态」；
 * - 用请求序号（requestSeq）丢弃过期响应：切页码/切标签后，先发后到的旧请求
 *   不会把新页码的数据覆盖回旧页；
 * - 标签不存在、标签下没有关联文章都是真实空态（posts 为空、无 error），
 *   不当成失败，也不去查文章；
 * - 数据契约不变：仍是 tags → post_tags → posts 的既有关系查询与字段。
 */
export function usePosts(page = 1, perPage = 10, tagSlug?: string): UsePostsResult {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  // retryToken 只用于触发重新取数，不参与查询参数，翻页/筛选的既有依赖保持不变。
  const [retryToken, setRetryToken] = useState(0);
  // 请求序号：同一 hook 实例内只有最新一次请求可以写状态。
  const requestSeq = useRef(0);

  useEffect(() => {
    const pb = authService.getPocketBase();
    const seq = ++requestSeq.current;
    const isCurrent = () => seq === requestSeq.current;

    const fetchPosts = async () => {
      setLoading(true);
      // 新请求开始即视为上一次失败已失效；失败时下面会重新写入 error。
      setError(null);
      try {
        let filter = 'status = "published"';

        if (tagSlug) {
          const tagRes = await pb.collection('tags').getList(1, 1, {
            filter: pb.filter('slug = {:slug}', { slug: tagSlug }),
          });
          if (!isCurrent()) return;
          const tag = tagRes.items[0];
          if (!tag) {
            // 标签不存在是真空态，不是请求失败。
            setPosts([]);
            setTotalPages(1);
            setError(null);
            return;
          }
          const ptRes = await pb.collection('post_tags').getFullList({
            filter: pb.filter('tag_id = {:tagId}', { tagId: tag.id }),
            fields: 'post_id',
          });
          if (!isCurrent()) return;
          const postIds = ptRes.map((pt) => (pt as unknown as { post_id: string }).post_id);
          if (postIds.length === 0) {
            setPosts([]);
            setTotalPages(1);
            setError(null);
            return;
          }
          filter += pb.filter(' && id in {:postIds}', { postIds: postIds.join(',') });
        }

        const result = await pb.collection('posts').getList<Post>(page, perPage, {
          filter,
          sort: '-published_at',
          expand: 'author',
        });
        if (!isCurrent()) return;

        setPosts(result.items);
        setTotalPages(result.totalPages);
        setError(null);
      } catch (err) {
        if (!isCurrent()) return;
        // 失败不能伪装成空数据：保留 error 供视图显示重试入口；
        // 同时清掉上一页的列表，避免把旧页码的内容当成当前页展示。
        setError(err as Error);
        setPosts([]);
        setTotalPages(1);
      } finally {
        if (isCurrent()) setLoading(false);
      }
    };

    fetchPosts();
  }, [page, perPage, tagSlug, retryToken]);

  const retry = useCallback(() => setRetryToken((token) => token + 1), []);

  return { posts, loading, error, totalPages, retry };
}
