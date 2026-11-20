import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useGuestbook } from '../../hooks/domains/useGuestbook';
import GuestbookForm from './GuestbookForm';
import GuestbookWall from './GuestbookWall';

const PER_PAGE = 20;

/**
 * 留言板容器：持有列表状态与分页逻辑，组合表单与留言墙。
 *
 * 「加载更多」的失败由 useGuestbook 内部吞掉异常后置 `error`，这里用
 * 「目标页是否真正到达」判断这一次懒加载是否失败：失败时只在墙底部提示，
 * 不清空已经看到的留言；重试仍然是继续取下一页，而不是回到第 1 页。
 */
export default function GuestbookBoard() {
  const { messages, loading, error, page, totalPages, fetchMessages, loadMore } = useGuestbook();
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  // 待确认的下一页；取数结束后据此判定成功（page 前进）或失败（page 未变）。
  const pendingPageRef = useRef<number | null>(null);

  useEffect(() => {
    fetchMessages(1, PER_PAGE);
  }, [fetchMessages]);

  useEffect(() => {
    if (pendingPageRef.current === null || loading) return;
    const target = pendingPageRef.current;
    pendingPageRef.current = null;
    setLoadMoreError(page !== target);
  }, [loading, page]);

  const handleLoadMore = useCallback(async () => {
    if (loadingMore || page >= totalPages) return;
    setLoadMoreError(false);
    setLoadingMore(true);
    pendingPageRef.current = page + 1;
    try {
      await loadMore();
    } catch {
      pendingPageRef.current = null;
      setLoadMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  }, [loadMore, loadingMore, page, totalPages]);

  const handlePosted = useCallback(() => {
    // 提交成功后重新取第一页（真实请求），让新留言立刻出现在墙上。
    void fetchMessages(1, PER_PAGE);
  }, [fetchMessages]);

  return (
    <div className="space-y-8">
      <GuestbookForm onPosted={handlePosted} />
      <GuestbookWall
        messages={messages}
        loading={loading}
        error={error}
        loadMoreError={loadMoreError}
        hasMore={page < totalPages}
        loadingMore={loadingMore}
        onLoadMore={handleLoadMore}
        onRetry={() => void fetchMessages(1, PER_PAGE)}
      />
    </div>
  );
}
