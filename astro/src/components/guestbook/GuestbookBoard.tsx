import React, { useCallback, useEffect, useState } from 'react';
import { useGuestbook } from '../../hooks/domains/useGuestbook';
import GuestbookForm from './GuestbookForm';
import GuestbookWall from './GuestbookWall';

const PER_PAGE = 20;

/** 留言板容器：持有列表状态与分页逻辑，组合表单与留言墙 */
export default function GuestbookBoard() {
  const { messages, loading, error, page, totalPages, fetchMessages, loadMore } = useGuestbook();
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    fetchMessages(1, PER_PAGE);
  }, [fetchMessages]);

  const handleLoadMore = useCallback(async () => {
    if (loadingMore || page >= totalPages) return;
    setLoadingMore(true);
    try {
      await loadMore();
    } catch {
      // 加载更多失败不打断已有内容，仅静默（用户可再次点击）
    } finally {
      setLoadingMore(false);
    }
  }, [loadMore, loadingMore, page, totalPages]);

  const handlePosted = useCallback((message: { id: string; nickname: string; content: string; created: string }) => {
    // 提交成功说明后端已恢复，清掉首屏错误态让新留言可见
    // 注意：useGuestbook 内部会自动更新 messages 状态
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
        onRetry={() => fetchMessages(1, PER_PAGE)}
      />
    </div>
  );
}