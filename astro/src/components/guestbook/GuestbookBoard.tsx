import React, { useCallback, useEffect, useState } from 'react';
import { useGuestbook } from '../../hooks/domains/useGuestbook';
import GuestbookForm from './GuestbookForm';
import GuestbookWall from './GuestbookWall';

const PER_PAGE = 20;

/** 最近一次请求的类型：决定一次失败该显示在整块首屏、列表顶部还是列表底部。 */
type RequestKind = 'initial' | 'refresh' | 'more';

/**
 * 留言板容器：持有列表状态与分页逻辑，组合表单与留言墙。
 *
 * `useGuestbook` 把「首屏 / 刷新 / 加载更多」的失败都收敛成同一个 `error`，
 * 且失败时不清空已有留言。这里记录最近一次请求的类型，把同一个 `error`
 * 还原成三种可区分的界面状态：
 * - `initial`：还没有留言 → 整块错误态（`GuestbookWall` 的 `error` 分支）；
 * - `refresh`：有旧留言时刷新失败 → 保留留言，顶部提示「刷新失败」并可重试；
 * - `more`：加载更多失败 → 保留留言，底部就地提示并重试。
 *
 * 错误标记全部由 `error` 派生，因此任何一次成功刷新 / 成功加载更多都会
 * 立即清掉上一次的「加载更多失败」，不需要手动 reset 旧状态。
 */
export default function GuestbookBoard() {
  const { messages, loading, error, page, totalPages, fetchMessages, loadMore } = useGuestbook();
  const [lastRequest, setLastRequest] = useState<RequestKind>('initial');

  useEffect(() => {
    void fetchMessages(1, PER_PAGE);
  }, [fetchMessages]);

  const handleLoadMore = useCallback(() => {
    // 请求进行中或已经取到最后一页时不再发请求。
    if (loading || page >= totalPages) return;
    setLastRequest('more');
    void loadMore();
  }, [loading, page, totalPages, loadMore]);

  const handleRefresh = useCallback(() => {
    setLastRequest('refresh');
    void fetchMessages(1, PER_PAGE);
  }, [fetchMessages]);

  // 提交成功后重新取第一页（真实请求），让新留言立刻出现在墙上。
  const handlePosted = handleRefresh;

  const hasMessages = messages.length > 0;
  const loadingMore = loading && lastRequest === 'more';
  const loadMoreError = hasMessages && error && lastRequest === 'more';
  const refreshError = hasMessages && error && lastRequest === 'refresh';

  return (
    <div className="space-y-8">
      <GuestbookForm onPosted={handlePosted} />
      <GuestbookWall
        messages={messages}
        loading={loading}
        error={error}
        refreshError={refreshError}
        loadMoreError={loadMoreError}
        hasMore={page < totalPages}
        loadingMore={loadingMore}
        onLoadMore={handleLoadMore}
        onRetry={handleRefresh}
      />
    </div>
  );
}
