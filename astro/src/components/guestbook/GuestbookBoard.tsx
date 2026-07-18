import React, { useCallback, useEffect, useState } from 'react';
import { getPocketBase } from '../../lib/pocketbase';
import GuestbookForm from './GuestbookForm';
import GuestbookWall from './GuestbookWall';

const PER_PAGE = 20;

interface GuestbookMessage {
  id: string;
  nickname: string;
  content: string;
  created: string;
}

/** 留言板容器：持有列表状态与分页逻辑，组合表单与留言墙 */
export default function GuestbookBoard() {
  const [messages, setMessages] = useState<GuestbookMessage[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);

  const fetchPage = useCallback(async (targetPage: number, append: boolean) => {
    const pb = getPocketBase();
    const result = await pb
      .collection('guestbook_messages')
      .getList<GuestbookMessage>(targetPage, PER_PAGE, { sort: '-created', filter: 'status = "show"' });
    setMessages((prev) => {
      if (!append) return result.items;
      // 追加分页时按 id 去重：本地刚插入的新留言会使服务器行整体下移，
      // 下一页可能重复返回上一页末尾的记录
      const existing = new Set(prev.map((m) => m.id));
      const fresh = result.items.filter((m) => !existing.has(m.id));
      return [...prev, ...fresh];
    });
    setPage(result.page);
    setTotalPages(result.totalPages || 1);
  }, []);

  const loadFirstPage = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      await fetchPage(1, false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage]);

  const handleLoadMore = useCallback(async () => {
    if (loadingMore || page >= totalPages) return;
    setLoadingMore(true);
    try {
      await fetchPage(page + 1, true);
    } catch {
      // 加载更多失败不打断已有内容，仅静默（用户可再次点击）
    } finally {
      setLoadingMore(false);
    }
  }, [fetchPage, loadingMore, page, totalPages]);

  const handlePosted = useCallback((message: GuestbookMessage) => {
    // 提交成功说明后端已恢复，清掉首屏错误态让新留言可见
    setError(false);
    setMessages((prev) => [message, ...prev]);
  }, []);

  return (
    <div className="space-y-8">
      <GuestbookForm onPosted={handlePosted} />
      <GuestbookWall
        messages={messages}
        loading={loading}
        error={error}
        hasMore={page < totalPages}
        loadingMore={loadingMore}
        onLoadMore={handleLoadMore}
        onRetry={loadFirstPage}
      />
    </div>
  );
}
