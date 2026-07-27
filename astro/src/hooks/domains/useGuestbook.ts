import { useState, useCallback } from 'react';
import { getPocketBase } from '../../lib/pocketbase';

export interface GuestbookMessage {
  id: string;
  nickname: string;
  content: string;
  created: string;
}

interface UseGuestbookReturn {
  messages: GuestbookMessage[];
  loading: boolean;
  error: boolean;
  page: number;
  totalPages: number;
  fetchMessages: (page?: number, perPage?: number) => Promise<void>;
  loadMore: () => Promise<void>;
  postMessage: (data: { nickname: string; content: string }) => Promise<boolean>;
}

/**
 * 留言板数据管理 Hook（前台使用）
 * 支持分页加载和提交新留言
 */
export function useGuestbook(): UseGuestbookReturn {
  const [messages, setMessages] = useState<GuestbookMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const fetchMessages = useCallback(async (pageNum = 1, perPage = 20) => {
    setLoading(true);
    setError(false);
    try {
      const pb = getPocketBase();
      const result = await pb.collection('guestbook_messages').getList(pageNum, perPage, {
        sort: '-created',
        filter: 'status = "show"',
      });
      const items = result.items.map((item) => ({
        id: item.id,
        nickname: item.nickname as string,
        content: item.content as string,
        created: item.created as string,
      }));
      if (pageNum === 1) {
        setMessages(items);
      } else {
        setMessages((prev) => [...prev, ...items]);
      }
      setPage(result.page);
      setTotalPages(result.totalPages);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (page >= totalPages) return;
    await fetchMessages(page + 1);
  }, [page, totalPages, fetchMessages]);

  const postMessage = useCallback(async (data: { nickname: string; content: string }): Promise<boolean> => {
    try {
      const pb = getPocketBase();
      await pb.collection('guestbook_messages').create({
        ...data,
        status: 'show',
      });
      // 重新加载第一页
      await fetchMessages(1);
      return true;
    } catch {
      return false;
    }
  }, [fetchMessages]);

  return {
    messages,
    loading,
    error,
    page,
    totalPages,
    fetchMessages,
    loadMore,
    postMessage,
  };
}