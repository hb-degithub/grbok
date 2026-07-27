import { useState, useEffect, useCallback } from 'react';
import { adminCommentService, type Comment, type CommentFilter } from '../../lib/services/adminCommentService';

export type { CommentFilter };

export function useAdminComments() {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<CommentFilter>('all');
  const [page, setPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  const loadComments = useCallback(async (filterVal: CommentFilter = filter, pageNum = 1) => {
    setLoading(true);
    setError(null);
    try {
      const result = await adminCommentService.getComments(filterVal, pageNum);
      setComments(result.items);
      setTotalItems(result.totalItems);
      setPage(pageNum);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadComments(filter);
  }, [filter, loadComments]);

  const approveComment = useCallback(async (id: string) => {
    try {
      await adminCommentService.approveComment(id);
      await loadComments(filter, page);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
      return false;
    }
  }, [filter, page, loadComments]);

  const rejectComment = useCallback(async (id: string) => {
    try {
      await adminCommentService.rejectComment(id);
      await loadComments(filter, page);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
      return false;
    }
  }, [filter, page, loadComments]);

  const deleteComment = useCallback(async (id: string) => {
    try {
      await adminCommentService.deleteComment(id);
      await loadComments(filter, page);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
      return false;
    }
  }, [filter, page, loadComments]);

  return {
    comments,
    loading,
    error,
    filter,
    setFilter,
    page,
    totalItems,
    loadComments,
    approveComment,
    rejectComment,
    deleteComment,
  };
}
