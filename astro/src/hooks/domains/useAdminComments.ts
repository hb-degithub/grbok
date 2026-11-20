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

  // 请求序号：只有最新一次请求允许写状态。
  // 切筛选/翻页会连发请求，网络返回顺序不保证；慢的旧请求晚到若照写，
  // 就会把用户当前看到的新筛选（或新页码）覆盖回旧数据。
  const requestSeqRef = useRef(0);

  // 筛选/关键词的同步镜像：setFilter/setQuery 要在同一次更新里把页码归 1，
  // 同时用它判断值是否真的变了（重复设置同一筛选不应清空当前页）。
  const filterRef = useRef(filter);
  const queryRef = useRef(query);

  const loadComments = useCallback(async (
    filterVal: CommentFilter = filter,
    pageNum = 1,
    queryVal: string = query,
  ) => {
    const requestedPage = Math.max(1, Math.floor(pageNum) || 1);
    const requestSeq = ++requestSeqRef.current;
    requestedPageRef.current = requestedPage;
    setLoading(true);
    setError(null);
    try {
      let result = await adminCommentService.getComments(filterVal, requestedPage, COMMENTS_PER_PAGE, queryVal);
      // 期间又发起了更新的请求：这次响应已过期，丢弃，不要覆盖新筛选/新页码的结果。
      if (requestSeq !== requestSeqRef.current) return;
      let effectivePage = requestedPage;

      // 末页数据被删空后，PB 会返回空 items 且 totalItems 已经缩小；
      // 这里按真实总数收敛到最后一页并重新请求，避免停在空白页。
      if (result.items.length === 0 && requestedPage > 1) {
        const lastPage = lastPageOf(result.totalItems);
        if (lastPage < requestedPage) {
          effectivePage = lastPage;
          result = await adminCommentService.getComments(filterVal, effectivePage, COMMENTS_PER_PAGE, queryVal);
          if (requestSeq !== requestSeqRef.current) return;
        }
      }

      setComments(result.items);
      setTotalItems(result.totalItems);
      setTotalPages(lastPageOf(result.totalItems));
      setPage(effectivePage);
      requestedPageRef.current = effectivePage;
    } catch (err) {
      // 过期请求的失败同样不能改写当前状态（错误/loading 都归最新请求管）。
      if (requestSeq !== requestSeqRef.current) return;
      // 失败只记录可读错误：保留上一次成功的 comments/totalItems/totalPages/page，
      // 既不伪装成「没有评论」，也不会让一次失败把统计清零。
      setError(describePbError(err, '评论列表加载失败'));
    } finally {
      // 只有最新请求能结束 loading；过期请求收尾会把仍在加载的新请求误标成已完成。
      if (requestSeq === requestSeqRef.current) setLoading(false);
    }
  }, [filter, query]);

  // 筛选/关键词变化：一律回到第 1 页重新取数。
  useEffect(() => {
    void loadComments(filter, 1, query);
  }, [filter, query, loadComments]);

  /**
   * 切筛选：页码必须和筛选在同一次状态更新里归 1。
   *
   * 若只等列表响应回来再 setPage（旧实现），从「筛选已变」到「响应到达」之间存在一个窗口：
   * 分页控件还显示上一个筛选的第 N 页（例如第 3 页），列表却是新筛选第 1 页的加载结果；
   * 窗口内的 refresh()/updateStatus()/批量操作也会带着旧页码去请求新筛选的数据。
   * 这段窗口在真实网络里是几百毫秒，在并行跑全量测试时会被调度延迟放大成可观测的竞态。
   */
  const changeFilter = useCallback((next: CommentFilter) => {
    if (filterRef.current === next) return;
    filterRef.current = next;
    requestedPageRef.current = 1;
    setFilter(next);
    setPage(1);
  }, []);

  /** 改关键词：与切筛选同理，页码同步归 1，不依赖响应时序。 */
  const changeQuery = useCallback((next: string) => {
    if (queryRef.current === next) return;
    queryRef.current = next;
    requestedPageRef.current = 1;
    setQuery(next);
    setPage(1);
  }, []);

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
    setFilter: changeFilter,
    query,
    setQuery: changeQuery,
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
