import { useState, useEffect, useCallback, useRef } from 'react';
import { adminPostService, type Post } from '../../lib/services/adminPostService';
import { showToast } from '../../components/ui/Toast';
import { describePbError } from '../../lib/pb-error';
import { notifyStepUpExpired } from '../../lib/step-up-recovery';

type PostDraft = Omit<Post, 'id' | 'created' | 'updated' | 'author' | 'published_at' | 'views'> & { id?: string };
type PostStatusFilter = 'all' | 'published' | 'draft' | 'archived';

/** 列表每页条数（PocketBase getList 参数，与改造前一致） */
export const POSTS_PER_PAGE = 20;

/**
 * 视图标识：页码、筛选、关键词任一变化都算「另一个视图」。
 * 失败时若当前视图与上一次成功视图不同，就清空旧数据，
 * 避免把上一筛选/上一页的结果冒充成新视图的结果。
 */
function viewKey(page: number, filter: PostStatusFilter, query: string) {
  return `${page}\u0000${filter}\u0000${query.trim()}`;
}

export function useAdminPosts() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilterState] = useState<PostStatusFilter>('all');
  const [query, setQueryState] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [editing, setEditing] = useState<Post | PostDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [allTags, setAllTags] = useState<{ id: string; name: string; slug: string }[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);

  // 每次请求自增的序号：只有最后一次请求允许写回状态（防止慢的旧请求覆盖新结果）
  const requestSeqRef = useRef(0);
  // 上一次成功加载对应的视图；失败时用来区分「刷新失败」与「切换视图失败」
  const loadedViewRef = useRef<string | null>(null);
  // 供 fetchPosts（无参刷新）读取最新分页/筛选，避免把 page 放进 effect 依赖造成回第 1 页
  const latestRef = useRef({ page, filter, query });
  // 当前正在编辑的草稿：保存是异步的，成功后要确认「现在还在编辑的仍是保存的那篇」
  const editingRef = useRef(editing);
  // 上一次成功加载的分页总量：翻页失败时用它保住「可回退分页」，不把用户困在空白页
  const totalPagesRef = useRef(1);
  // savePost 同步防重入锁：state 更新是异步的，双击时第二下可能仍在旧渲染里
  const savingRef = useRef(false);

  useEffect(() => {
    latestRef.current = { page, filter, query };
  }, [page, filter, query]);

  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  const loadPage = useCallback(
    async (targetPage: number, targetFilter: PostStatusFilter, targetQuery: string) => {
      const seq = requestSeqRef.current + 1;
      requestSeqRef.current = seq;
      const requestedView = viewKey(targetPage, targetFilter, targetQuery);
      setLoading(true);
      // 新请求一开始就清掉上一次的错误：重试/切页时不再显示过期错误，且 loading 有反馈
      setError(null);
      try {
        const result = await adminPostService.getPosts(targetPage, POSTS_PER_PAGE, {
          status: targetFilter !== 'all' ? targetFilter : undefined,
          query: targetQuery.trim() || undefined,
        });
        // 已有更新的请求发出：丢弃这次结果
        if (seq !== requestSeqRef.current) return;
        const nextTotalPages = Math.max(1, result.totalPages || 1);
        setPosts(result.items);
        setTotalPages(nextTotalPages);
        totalPagesRef.current = nextTotalPages;
        loadedViewRef.current = requestedView;
        setError(null);
        // 删除末页最后一条后页码可能越界：收敛到真实末页，避免停在空白页
        if (targetPage > 1 && result.items.length === 0 && targetPage > nextTotalPages) {
          setPage(nextTotalPages);
        }
      } catch (err) {
        if (seq !== requestSeqRef.current) return;
        // 失败时保留上一次成功的数据与分页（不清空成「没有文章」），
        // 并把错误显式提示给用户，避免把请求失败伪装成空数据。
        const message = notifyStepUpExpired(err)
          ? '管理会话已过期，请重新验证动态口令'
          : describePbError(err, '文章列表加载失败');
        setError(message);
        // 失败的是「另一个视图」（切了筛选/搜索/页码）：旧数据不能冒充新结果
        if (loadedViewRef.current !== requestedView) {
          setPosts([]);
          // 保留上一次成功时的分页总量，用户仍能点「上一页」退回去；
          // 若失败页已超出可回退范围，安全地收敛到最后一页可回退的页码。
          const fallbackTotalPages = Math.max(1, totalPagesRef.current);
          setTotalPages(fallbackTotalPages);
          if (targetPage > fallbackTotalPages) setPage(fallbackTotalPages);
        }
        showToast(message, 'error');
      } finally {
        if (seq === requestSeqRef.current) setLoading(false);
      }
    },
    [],
  );

  // 唯一的列表加载 effect：页码/筛选/关键词变化时按当前值请求一次。
  // fetchPosts 不再依赖 page，effect 也不会因 fetchPosts 变化而重置页码。
  useEffect(() => {
    void loadPage(page, filter, query);
  }, [page, filter, query, loadPage]);

  const setFilter = useCallback((next: PostStatusFilter) => {
    setFilterState(next);
    setPage(1);
  }, []);

  const setQuery = useCallback((next: string) => {
    setQueryState(next);
    setPage(1);
  }, []);

  /** 手动刷新当前视图（保存/删除/状态更新后调用），沿用当前页与筛选。 */
  const fetchPosts = useCallback(async () => {
    const current = latestRef.current;
    await loadPage(current.page, current.filter, current.query);
  }, [loadPage]);

  // Load available tags when editing（新草稿也要加载，否则新建文章无法选标签）
  const editingOpen = editing !== null;
  const editingId = editing?.id ?? null;
  useEffect(() => {
    if (!editingOpen) return;
    let cancelled = false;
    adminPostService.getTags().then(r => {
      if (cancelled) return;
      setAllTags(r.items.map((item) => ({ id: item.id, name: item.name, slug: item.slug })));
    }).catch(() => {});
    if (editingId) {
      adminPostService.getPostTags(editingId).then(r => {
        if (cancelled) return;
        setSelectedTagIds(r.items.map((item) => item.tag_id));
      }).catch(() => {});
    } else {
      setSelectedTagIds([]);
    }
    return () => { cancelled = true; };
  }, [editingOpen, editingId]);

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

  const savePost = useCallback(async (_skipChecks = false) => {
    if (!editing) return;
    // 保存开始时的草稿快照：成功后只有「现在仍在编辑这一篇」才关闭，
    // 避免慢请求完成时把用户在此期间打开的另一篇误关掉。
    const draftAtSave = editing;
    
    // 必填校验
    if (!editing.title?.trim()) {
      showToast('请填写文章标题', 'error');
      return;
    }
    if (!editing.content?.trim()) {
      showToast('请填写文章内容', 'error');
      return;
    }

    // 同步防重入：保存进行中时重复点击/重复调用直接忽略
    if (savingRef.current) return;
    savingRef.current = true;
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

      // 只有「当前仍在编辑被保存的这一篇」才关闭并清标签：
      // 同一篇（对象未换 / id 相同）才关；期间新开/切到别的文章保持原样。
      const currentDraft = editingRef.current;
      const stillEditingSavedPost = currentDraft !== null && (
        currentDraft === draftAtSave || currentDraft.id === savedPostId
      );
      if (stillEditingSavedPost) {
        setEditing(null);
        setDirty(false);
        setSelectedTagIds([]);
      }
      fetchPosts();
      showToast('文章保存成功', 'success');
    } catch (err) {
      console.error('保存文章失败:', err);
      if (notifyStepUpExpired(err)) {
        showToast('管理会话已过期，请重新验证动态口令', 'error');
        return;
      }
      showToast(describePbError(err, '保存失败'), 'error');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [editing, selectedTagIds, fetchPosts]);

  return {
    posts,
    loading,
    error,
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
