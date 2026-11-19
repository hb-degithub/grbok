import { useState, useEffect, useCallback, useRef } from 'react';
import { adminCommentService, type Comment, type CommentFilter } from '../../lib/services/adminCommentService';
import { describePbError } from '../../lib/pb-error';

export type { CommentFilter };

/** 与 adminCommentService.getComments 的默认 perPage 保持一致，分页 UI 复用同一口径。 */
export const COMMENTS_PER_PAGE = 20;

function lastPageOf(totalItems: number): number {
  return Math.max(1, Math.ceil(Math.max(0, totalItems) / COMMENTS_PER_PAGE));
}

export function useAdminComments() {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<CommentFilter>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // 最近一次「请求过」的页码。加载失败时 page 仍停在最后一次成功页（界面上还是那批数据），
  // 但重试要重试用户真正想看的那一页，而不是跳回第 1 页。
  const requestedPageRef = useRef(1);

  const loadComments = useCallback(async (
    filterVal: CommentFilter = filter,
    pageNum = 1,
    queryVal: string = query,
  ) => {
    const requestedPage = Math.max(1, Math.floor(pageNum) || 1);
    requestedPageRef.current = requestedPage;
    setLoading(true);
    setError(null);
    try {
      let result = await adminCommentService.getComments(filterVal, requestedPage, COMMENTS_PER_PAGE, queryVal);
      let effectivePage = requestedPage;

      // 末页数据被删空后，PB 会返回空 items 且 totalItems 已经缩小；
      // 这里按真实总数收敛到最后一页并重新请求，避免停在空白页。
      if (result.items.length === 0 && requestedPage > 1) {
        const lastPage = lastPageOf(result.totalItems);
        if (lastPage < requestedPage) {
          effectivePage = lastPage;
          result = await adminCommentService.getComments(filterVal, effectivePage, COMMENTS_PER_PAGE, queryVal);
        }
      }

      setComments(result.items);
      setTotalItems(result.totalItems);
      setTotalPages(lastPageOf(result.totalItems));
      setPage(effectivePage);
      requestedPageRef.current = effectivePage;
    } catch (err) {
      // 失败只记录可读错误：保留上一次成功的 comments/totalItems/totalPages/page，
      // 既不伪装成「没有评论」，也不会让一次失败把统计清零。
      setError(describePbError(err, '评论列表加载失败'));
    } finally {
      setLoading(false);
    }
  }, [filter, query]);

  // 筛选/关键词变化：一律回到第 1 页重新取数。
  useEffect(() => {
    void loadComments(filter, 1, query);
  }, [filter, query, loadComments]);

  /** 跳页：真正按第 pageNum 页取数（此前只 setPage，页码变了却不取数）。 */
  const goToPage = useCallback((pageNum: number) => {
    const target = Math.min(Math.max(1, Math.floor(pageNum) || 1), Math.max(1, totalPages));
    return loadComments(filter, target, query);
  }, [filter, loadComments, query, totalPages]);

  /** 按当前筛选/页码/关键词重新拉取列表（供外部写入后刷新，如 AI 草稿正文保存） */
  const refresh = useCallback(() => loadComments(filter, page, query), [loadComments, filter, page, query]);

  /** 失败重试：重试刚才请求失败的那一页（失败时 page 仍停在最后一次成功页）。 */
  const retry = useCallback(() => loadComments(filter, requestedPageRef.current, query), [loadComments, filter, query]);

  const updateStatus = useCallback(async (id: string, status: Comment['status']) => {
    try {
      await adminCommentService.updateStatus(id, status);
      await loadComments(filter, page, query);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
      return false;
    }
  }, [filter, page, query, loadComments]);

  const batchUpdateStatus = useCallback(async (ids: string[], status: Comment['status']) => {
    try {
      await adminCommentService.batchUpdateStatus(ids, status);
      await loadComments(filter, page, query);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
      return false;
    }
  }, [filter, page, query, loadComments]);

  const batchDelete = useCallback(async (ids: string[]) => {
    try {
      await adminCommentService.batchDelete(ids);
      await loadComments(filter, page, query);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量删除失败');
      return false;
    }
  }, [filter, page, query, loadComments]);

  const deleteComment = useCallback(async (id: string) => {
    try {
      await adminCommentService.deleteComment(id);
      await loadComments(filter, page, query);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
      return false;
    }
  }, [filter, page, query, loadComments]);

  return {
    comments,
    loading,
    error,
    filter,
    setFilter,
    query,
    setQuery,
    page,
    totalPages,
    totalItems,
    goToPage,
    loadComments,
    refresh,
    retry,
    updateStatus,
    deleteComment,
    batchUpdateStatus,
    batchDelete,
  };
}
