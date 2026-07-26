import React, { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { getPocketBase } from '../../lib/pocketbase';
import { describePbError } from '../../lib/pb-error';
import { notifyStepUpExpired } from '../../lib/step-up-recovery';

interface GuestbookItem {
  id: string;
  nickname: string;
  content: string;
  status: string;
  created: string;
}

const STATUS_TONE: Record<string, string> = {
  show: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  hidden: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500',
};

export default function GuestbookModerator() {
  const [items, setItems] = useState<GuestbookItem[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const pb = getPocketBase();
      const result = await pb.collection('guestbook_messages').getList<GuestbookItem>(1, 50, {
        sort: '-created',
        filter: filter ? `status = "${filter}"` : undefined,
      });
      setItems(result.items || []);
    } catch (err: unknown) {
      setError((err as Error)?.message || '无法读取留言');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const toggleStatus = useCallback(async (item: GuestbookItem) => {
    const next = item.status === 'show' ? 'hidden' : 'show';
    setError('');
    setStatus('');
    try {
      const pb = getPocketBase();
      await pb.collection('guestbook_messages').update(item.id, { status: next });
      setItems((prev) => prev.map((it) => it.id === item.id ? { ...it, status: next } : it));
      setStatus(`留言已${next === 'show' ? '显示' : '隐藏'}`);
    } catch (err: unknown) {
      const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
      if (notifyStepUpExpired(err)) { setError('管理会话已过期，请重新验证动态口令'); return; }
      setError(describePbError(err, code || '操作失败'));
    }
  }, []);

  const remove = useCallback(async (item: GuestbookItem) => {
    if (!window.confirm(`确定删除「${item.nickname}」的留言？此操作不可逆。`)) return;
    setError('');
    setStatus('');
    try {
      const pb = getPocketBase();
      await pb.collection('guestbook_messages').delete(item.id);
      setItems((prev) => prev.filter((it) => it.id !== item.id));
      setStatus('留言已删除');
    } catch (err: unknown) {
      const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
      if (notifyStepUpExpired(err)) { setError('管理会话已过期，请重新验证动态口令'); return; }
      setError(describePbError(err, code || '删除失败'));
    }
  }, []);

  const fmtDate = (s: string) => {
    if (!s) return '-';
    try { return new Date(s.replace(' ', 'T')).toLocaleString('zh-CN'); } catch { return s; }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-w-0 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">留言治理</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">管理公开留言板的显示与删除</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {['', 'show', 'hidden'].map((s) => (
          <button
            key={s || 'all'}
            onClick={() => setFilter(s)}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
              filter === s
                ? 'bg-indigo-600 text-white'
                : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
            }`}
          >
            {s === 'show' ? '显示中' : s === 'hidden' ? '已隐藏' : '全部'}
          </button>
        ))}
      </div>

      {error && <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</div>}
      {status && <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{status}</div>}
      {loading && <p className="text-sm text-zinc-500 dark:text-zinc-400">加载中…</p>}

      {!loading && items.length === 0 && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">暂无留言记录</p>
      )}

      {!loading && items.length > 0 && (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="card rounded-xl p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">{item.nickname}</span>
                  <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_TONE[item.status] || STATUS_TONE.hidden}`}>{item.status === 'show' ? '显示' : '隐藏'}</span>
                </div>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">{fmtDate(item.created)}</span>
              </div>
              <p className="break-words text-sm text-zinc-700 dark:text-zinc-300">{item.content}</p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => toggleStatus(item)}
                  className="rounded-lg bg-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600"
                >
                  {item.status === 'show' ? '隐藏' : '显示'}
                </button>
                <button
                  onClick={() => remove(item)}
                  className="rounded-lg bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-200 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-900/40"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}