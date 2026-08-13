import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { adminPostService, type Post, type PostFilter } from '../../lib/services/adminPostService';
import { showToast } from '../../components/ui/Toast';
import { describePbError } from '../../lib/pb-error';
import { notifyStepUpExpired } from '../../lib/step-up-recovery';

type PostDraft = Omit<Post, 'id' | 'created' | 'updated' | 'author' | 'published_at' | 'views'> & { id?: string };
type PostStatusFilter = 'all' | 'published' | 'draft' | 'archived';

export function useAdminPosts() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<PostStatusFilter>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [editing, setEditing] = useState<Post | PostDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [allTags, setAllTags] = useState<{ id: string; name: string; slug: string }[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    try {
      const result = await adminPostService.getPosts(page, 20, {
        status: filter !== 'all' ? filter : undefined,
        query: query.trim() || undefined,
      });
      setPosts(result.items);
      setTotalPages(result.totalPages);
    } catch (err) {
      console.error('获取文章失败:', err);
    } finally {
      setLoading(false);
    }
  }, [filter, page, query]);

  // 当 filter 或 query 变化时，重置 page 为 1 并获取数据
  useEffect(() => {
    setPage(1);
    fetchPosts();
  }, [filter, query, fetchPosts]);

  // Load available tags when editing
  useEffect(() => {
    if (!editing) return;
    adminPostService.getTags().then(r => {
      setAllTags(r.items.map((item) => ({ id: item.id, name: item.name, slug: item.slug })));
    }).catch(() => {});
    if (editing.id) {
      adminPostService.getPostTags(editing.id).then(r => {
        setSelectedTagIds(r.items.map((item) => item.tag_id));
      }).catch(() => {});
    } else {
      setSelectedTagIds([]);
    }
  }, [editing?.id]);

  const updateStatus = useCallback(async (id: string, status: Post['status']) => {
    try {
      await adminPostService.updatePostStatus(id, status);
      showToast('状态更新成功', 'success');
      fetchPosts();
    } catch (err) {
      console.error('更新文章状态失败:', err);
      if (notifyStepUpExpired(err)) {
        showToast('管理会话已过期，请重新验证动态口令', 'error');
        return;
      }
      showToast(describePbError(err, '状态更新失败'), 'error');
    }
  }, [fetchPosts]);

  const deletePost = useCallback(async (id: string) => {
    try {
      await adminPostService.deletePost(id);
      showToast('文章已删除', 'success');
      fetchPosts();
    } catch (err) {
      console.error('删除文章失败:', err);
      if (notifyStepUpExpired(err)) {
        showToast('管理会话已过期，请重新验证动态口令', 'error');
        return;
      }
      showToast(describePbError(err, '删除文章失败'), 'error');
    }
  }, [fetchPosts]);

  const savePost = useCallback(async (skipChecks = false) => {
    if (!editing) return;
    
    // 必填校验
    if (!editing.title?.trim()) {
      showToast('请填写文章标题', 'error');
      return;
    }
    if (!editing.content?.trim()) {
      showToast('请填写文章内容', 'error');
      return;
    }
    
    setSaving(true);
    try {
      // 自动生成 slug（如果为空）
      const SLUG_PATTERN = /^[a-zA-Z0-9\u4e00-\u9fff][a-zA-Z0-9\u4e00-\u9fff_-]*$/;
      let slug = editing.slug?.trim() || '';
      if (!slug && editing.title) {
        slug = editing.title
          .toLowerCase()
          .replace(/[^\w\u4e00-\u9fff]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 160);
      }
      // 整体不合法时先清洗，清洗后仍不合法才用时间戳兜底
      if (!SLUG_PATTERN.test(slug)) {
        slug = slug.replace(/[^\w\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 160);
      }
      if (!slug || !SLUG_PATTERN.test(slug)) {
        slug = `post-${Date.now()}`;
      }

      // slug 唯一性预检：冲突时自动追加后缀
      if (!editing.id) {
        try {
          const existing = await adminPostService.getPosts(1, 1, { query: slug });
          if (existing.items.some(p => p.slug === slug)) {
            slug = `${slug}-${Date.now().toString(36)}`;
          }
        } catch { /* 查询失败时继续，让服务端校验 */ }
      }

      const data: Partial<Post> = {
        title: editing.title,
        slug: slug,
        excerpt: editing.excerpt || '',
        content: editing.content || '',
        cover: editing.cover || '',
        status: editing.status,
        is_pinned: editing.is_pinned ?? false,
        is_featured: editing.is_featured ?? false,
        seo_title: editing.seo_title || '',
        seo_description: editing.seo_description || '',
        seo_keywords: editing.seo_keywords || '',
      };
      const publishedAt = 'published_at' in editing ? editing.published_at : '';
      if (editing.status === 'published' && !publishedAt) {
        data.published_at = new Date().toISOString();
      }

      let savedPostId: string;
      if (editing.id && editing.id.trim()) {
        await adminPostService.updatePost(editing.id, data);
        savedPostId = editing.id;
      } else {
        const created = await adminPostService.createPost(data);
        savedPostId = created.id;
      }

      // Sync tags（独立 try/catch，避免文章已建但标签失败导致重试重复 slug）
      if (savedPostId) {
        try {
          await adminPostService.syncPostTags(savedPostId, selectedTagIds);
        } catch (tagErr) {
          if (!notifyStepUpExpired(tagErr)) {
            showToast(describePbError(tagErr, '标签同步失败'), 'warning');
          }
        }
      }

      setEditing(null);
      setDirty(false);
      fetchPosts();
      setSelectedTagIds([]);
      showToast('文章保存成功', 'success');
    } catch (err) {
      console.error('保存文章失败:', err);
      if (notifyStepUpExpired(err)) {
        showToast('管理会话已过期，请重新验证动态口令', 'error');
        return;
      }
      showToast(describePbError(err, '保存失败'), 'error');
    } finally {
      setSaving(false);
    }
  }, [editing, selectedTagIds, fetchPosts]);

  return {
    posts,
    loading,
    filter,
    setFilter,
    query,
    setQuery,
    page,
    setPage,
    totalPages,
    editing,
    setEditing,
    saving,
    dirty,
    setDirty,
    allTags,
    selectedTagIds,
    setSelectedTagIds,
    fetchPosts,
    updateStatus,
    deletePost,
    savePost,
  };
}