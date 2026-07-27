import { useState, useEffect, useCallback } from 'react';
import { friendLinkService } from '../../lib/services/friendLinkService';
import { showToast } from '../../components/ui/Toast';
import { describePbError } from '../../lib/pb-error';
import { notifyStepUpExpired } from '../../lib/step-up-recovery';
import type { FriendLink } from '../../types/pocketbase';

interface UseFriendLinksOptions {
  /** 是否自动获取数据 */
  autoFetch?: boolean;
  /** 是否只获取显示的友链 */
  visibleOnly?: boolean;
}

interface UseFriendLinksReturn {
  links: FriendLink[];
  loading: boolean;
  error: Error | null;
  saving: boolean;
  fetchLinks: () => Promise<void>;
  saveLink: (data: Partial<FriendLink>) => Promise<boolean>;
  deleteLink: (id: string) => Promise<boolean>;
  toggleStatus: (link: FriendLink) => Promise<boolean>;
  validateLink: (data: Partial<FriendLink>) => string | null;
}

/**
 * 友链数据管理 Hook
 * 封装友链的获取、保存、删除、状态切换等操作
 */
export function useFriendLinks(options: UseFriendLinksOptions = {}): UseFriendLinksReturn {
  const { autoFetch = true, visibleOnly = false } = options;

  const [links, setLinks] = useState<FriendLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchLinks = useCallback(async () => {
    setLoading(true);
    try {
      const data = visibleOnly
        ? await friendLinkService.getVisible()
        : await friendLinkService.getAllSorted();
      setLinks(data);
      setError(null);
    } catch (err) {
      console.error('获取友链失败：', err);
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [visibleOnly]);

  useEffect(() => {
    if (autoFetch) {
      fetchLinks();
    }
  }, [autoFetch, fetchLinks]);

  const validateLink = useCallback((data: Partial<FriendLink>): string | null => {
    return friendLinkService.validate(data);
  }, []);

  const saveLink = useCallback(async (data: Partial<FriendLink>): Promise<boolean> => {
    const validationError = friendLinkService.validate(data);
    if (validationError) {
      showToast(validationError, 'error');
      return false;
    }

    setSaving(true);
    try {
      await friendLinkService.save(data);
      await fetchLinks();
      showToast(data.id ? '友链更新成功' : '友链创建成功', 'success');
      return true;
    } catch (err) {
      console.error('保存友链失败：', err);
      if (notifyStepUpExpired(err)) {
        showToast('管理会话已过期，请重新验证动态口令', 'error');
        return false;
      }
      showToast(describePbError(err, '保存失败'), 'error');
      return false;
    } finally {
      setSaving(false);
    }
  }, [fetchLinks]);

  const deleteLink = useCallback(async (id: string): Promise<boolean> => {
    try {
      await friendLinkService.delete(id);
      await fetchLinks();
      showToast('友链已删除', 'success');
      return true;
    } catch (err) {
      console.error('删除友链失败：', err);
      if (notifyStepUpExpired(err)) {
        showToast('管理会话已过期，请重新验证动态口令', 'error');
        return false;
      }
      showToast(describePbError(err, '删除友链失败'), 'error');
      return false;
    }
  }, [fetchLinks]);

  const toggleStatus = useCallback(async (link: FriendLink): Promise<boolean> => {
    try {
      const updated = await friendLinkService.toggleStatus(link);
      setLinks(prev => prev.map(l => l.id === link.id ? updated : l));
      return true;
    } catch (err) {
      console.error('切换友链状态失败：', err);
      if (notifyStepUpExpired(err)) {
        showToast('管理会话已过期，请重新验证动态口令', 'error');
        return false;
      }
      showToast(describePbError(err, '操作失败'), 'error');
      return false;
    }
  }, []);

  return {
    links,
    loading,
    error,
    saving,
    fetchLinks,
    saveLink,
    deleteLink,
    toggleStatus,
    validateLink,
  };
}
