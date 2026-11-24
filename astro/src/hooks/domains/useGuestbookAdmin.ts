import { useState, useEffect, useCallback } from 'react';
import {
  guestbookService,
  guestbookVerdictLabel,
  type GuestbookItem,
  type GuestbookModerateResult,
} from '../../lib/services/guestbookService';
import { describePbError } from '../../lib/pb-error';
import { notifyStepUpExpired } from '../../lib/step-up-recovery';

/** 批量 AI 审核进度与汇总：approved 通过 / hidden 隐藏（spam 后后端置 hide） / unsure 存疑 / failed 失败 */
export interface GuestbookModerationSummary {
  total: number;
  done: number;
  approved: number;
  hidden: number;
  unsure: number;
  failed: number;
}

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
  /** 正在单条 AI 审核的留言 id（'' = 空闲） */
  moderatingId: string;
  /** 是否正在串行跑「AI 审核全部」 */
  moderatingAll: boolean;
  /** 最近一次批量审核的进度/汇总（完成后保留，便于查看结果） */
  moderationSummary: GuestbookModerationSummary | null;
  moderate: (item: GuestbookItem) => Promise<boolean>;
  moderateAll: () => Promise<void>;
}

/**
 * 用审核响应更新列表项，先本地回显徽章，再静默刷新拿服务端权威状态。
 * spam 时服务端会把 status 置为 hide；响应未带 status 时按同一语义兜底。
 */
function applyModeration(item: GuestbookItem, result: GuestbookModerateResult): GuestbookItem {
  const status = result.status || (result.verdict === 'spam' ? 'hide' : item.status);
  return {
    ...item,
    ai_verdict: result.verdict,
    ai_reason: result.reason,
    ai_moderated: true,
    status,
  };
}

/**
 * 留言板管理 Hook（Admin 后台使用）
 * 封装留言的获取、删除、状态切换，以及 AI 审核（单条 / 串联批量）。
 */
export function useGuestbookAdmin(): UseGuestbookAdminReturn {
  const [items, setItems] = useState<GuestbookItem[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [moderatingId, setModeratingId] = useState('');
  const [moderatingAll, setModeratingAll] = useState(false);
  const [moderationSummary, setModerationSummary] = useState<GuestbookModerationSummary | null>(null);

  const fetchItems = useCallback(async (silent: boolean) => {
    // 静默刷新不能清掉刚设置的错误/step-up 提示（批量审核中途失败时尤其明显）
    if (!silent) {
      setLoading(true);
      setError('');
    }
    try {
      const data = await guestbookService.getItems(filter);
      setItems(data);
    } catch (err: unknown) {
      setError((err as Error)?.message || '无法读取留言');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [filter]);

  const load = useCallback(() => fetchItems(false), [fetchItems]);

  useEffect(() => {
    void load();
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

  /** 单条 AI 审核：成功后本地回显徽章 + 静默刷新 */
  const moderate = useCallback(async (item: GuestbookItem): Promise<boolean> => {
    if (moderatingId) return false;
    setModeratingId(item.id);
    setError('');
    setStatus('');
    try {
      const result = await guestbookService.moderate(item.id);
      setItems((prev) => prev.map((it) => it.id === item.id ? applyModeration(it, result) : it));
      setStatus(
        `AI 审核完成：${guestbookVerdictLabel(result.verdict)}${result.reason ? `（${result.reason}）` : ''}`,
      );
      void fetchItems(true);
      return true;
    } catch (err: unknown) {
      if (notifyStepUpExpired(err)) {
        setError('管理会话已过期，请重新验证动态口令');
        return false;
      }
      setError(err instanceof Error ? err.message : 'AI 审核失败');
      return false;
    } finally {
      setModeratingId('');
    }
  }, [fetchItems, moderatingId]);

  /**
   * 批量 AI 审核：串行处理当前列表全部留言，单条失败不中断。
   * 进度与汇总写入 moderationSummary；step-up 过期时停止后续请求（继续发也只会全失败）。
   */
  const moderateAll = useCallback(async (): Promise<void> => {
    if (moderatingAll || moderatingId || items.length === 0) return;
    const targets = [...items];
    const summary: GuestbookModerationSummary = {
      total: targets.length,
      done: 0,
      approved: 0,
      hidden: 0,
      unsure: 0,
      failed: 0,
    };
    const results = new Map<string, GuestbookModerateResult>();
    let interrupted = false;

    setModeratingAll(true);
    setError('');
    setStatus('');
    setModerationSummary({ ...summary });

    for (const item of targets) {
      try {
        const result = await guestbookService.moderate(item.id);
        results.set(item.id, result);
        summary.done += 1;
        if (result.verdict === 'approve') summary.approved += 1;
        else if (result.verdict === 'spam') summary.hidden += 1;
        else if (result.verdict === 'unsure') summary.unsure += 1;
        else summary.failed += 1;
      } catch (err: unknown) {
        summary.done += 1;
        summary.failed += 1;
        if (notifyStepUpExpired(err)) {
          setError('管理会话已过期，请重新验证动态口令，未完成的留言未审核');
          interrupted = true;
        }
      }
      setModerationSummary({ ...summary });
      if (interrupted) break;
    }

    // 先本地回显已拿到的结论，再统一静默刷新（避免 N 次列表请求）
    if (results.size > 0) {
      setItems((prev) => prev.map((it) => {
        const result = results.get(it.id);
        return result ? applyModeration(it, result) : it;
      }));
    }
    setModeratingAll(false);
    setModerationSummary({ ...summary });
    setStatus(
      `${interrupted ? 'AI 审核已中断' : 'AI 审核完成'}：` +
        `通过 ${summary.approved} / 隐藏 ${summary.hidden} / 存疑 ${summary.unsure} / 失败 ${summary.failed}` +
        `（已完成 ${summary.done}/${summary.total}）`,
    );
    void fetchItems(true);
  }, [items, moderatingAll, moderatingId, fetchItems]);

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
    moderatingId,
    moderatingAll,
    moderationSummary,
    moderate,
    moderateAll,
  };
}
