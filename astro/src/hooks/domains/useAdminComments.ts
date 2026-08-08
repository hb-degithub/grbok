import { useState, useEffect, useCallback } from 'react';
import { adminCommentService, type Comment, type CommentFilter } from '../../lib/services/adminCommentService';

export type { CommentFilter };

export function useAdminComments() {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<CommentFilter>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const loadComments = useCallback(async (filterVal: CommentFilter = filter, pageNum = 1, queryVal = query) => {
    setLoading(true);
    setError(null);
    try {
      const result = await adminCommentService.getComments(filterVal, pageNum, 20, queryVal);
      setComments(result.items);
      setTotalItems(result.totalItems);
      setTotalPages(Math.max(1, Math.ceil(result.totalItems / 20)));
      setPage(pageNum);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [filter, query]);

  useEffect(() => {
    loadComments(filter, 1, query);
  }, [filter, query, loadComments]);

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
    setPage,
    totalPages,
    updateStatus,
    deleteComment,
    batchUpdateStatus,
    batchDelete,
  };
}
