import { useState, useEffect, useCallback } from 'react';
import { guestbookService, type GuestbookItem } from '../../lib/services/guestbookService';
import { describePbError } from '../../lib/pb-error';
import { notifyStepUpExpired } from '../../lib/step-up-recovery';

interface UseGuestbookAdminReturn {
  items: GuestbookItem[];
  loading: boolean;
  error: string;
  status: string;
  filter: string;
  setFilter: (filter: string) => void;
  setError: (error: string) => void;
  setStatus: (status: string) => void;
  load: () => Promise<void>;
  toggleStatus: (item: GuestbookItem) => Promise<boolean>;
  remove: (item: GuestbookItem) => Promise<boolean>;
}

/**
 * 留言板管理 Hook（Admin 后台使用）
 * 封装留言的获取、删除、状态切换等操作
 */
export function useGuestbookAdmin(): UseGuestbookAdminReturn {
  const [items, setItems] = useState<GuestbookItem[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await guestbookService.getItems(filter);
      setItems(data);
    } catch (err: unknown) {
      setError((err as Error)?.message || '无法读取留言');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleStatus = useCallback(async (item: GuestbookItem): Promise<boolean> => {
    setError('');
    setStatus('');
    try {
      const updated = await guestbookService.toggleStatus(item);
      setItems((prev) => prev.map((it) => it.id === item.id ? updated : it));
      setStatus(`留言已${updated.status === 'show' ? '显示' : '隐藏'}`);
      return true;
    } catch (err: unknown) {
      const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
      if (notifyStepUpExpired(err)) {
        setError('管理会话已过期，请重新验证动态口令');
        return false;
      }
      setError(describePbError(err, code || '操作失败'));
      return false;
    }
  }, []);

  const remove = useCallback(async (item: GuestbookItem): Promise<boolean> => {
    setError('');
    setStatus('');
    try {
      await guestbookService.delete(item.id);
      setItems((prev) => prev.filter((it) => it.id !== item.id));
      setStatus('留言已删除');
      return true;
    } catch (err: unknown) {
      const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
      if (notifyStepUpExpired(err)) {
        setError('管理会话已过期，请重新验证动态口令');
        return false;
      }
      setError(describePbError(err, code || '删除失败'));
      return false;
    }
  }, []);

  return {
    items,
    loading,
    error,
    status,
    filter,
    setFilter,
    setError,
    setStatus,
    load,
    toggleStatus,
    remove,
  };
}
