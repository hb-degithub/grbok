import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getPocketBase } from '../../lib/pocketbase';
import { showToast } from '../ui/Toast';
import ConfirmDialog from '../ui/ConfirmDialog';
import { cn } from '../../lib/utils';
import type { Announcement } from '../../types/pocketbase';

type AnnDraft = Omit<Announcement, 'id' | 'created' | 'updated'> & { id?: string };

const emptyDraft: AnnDraft = { title: '', content: '', type: 'normal', enabled: true, start_at: '', end_at: '' };

const listVariants = {
  hidden: { opacity: 1 },
  visible: { transition: { staggerChildren: 0.04 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] } },
};

const typeStyles: Record<string, string> = {
  info: 'border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200',
  warning: 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  important: 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200',
  normal: 'border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300',
};

const typeLabels: Record<string, string> = {
  info: '信息',
  warning: '警告',
  important: '重要',
  normal: '普通',
};

function toInputDate(iso: string | undefined): string {
  if (!iso) return '';
  try { return new Date(iso).toISOString().slice(0, 16); } catch { return ''; }
}

function fromInputDate(value: string): string {
  if (!value) return '';
  try { return new Date(value).toISOString(); } catch { return ''; }
}

export default function AnnouncementsManager() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AnnDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmState, setConfirmState] = useState<{ open: boolean; id: string }>({ open: false, id: '' });

  const fetchItems = useCallback(async () => {
    setLoading(true);
    const pb = getPocketBase();
    try {
      const result = await pb.collection('announcements').getList<Announcement>(1, 100, { sort: '-created' });
      setItems(result.items);
    } catch (err) {
      console.error('获取公告失败:', err);
      showToast('公告加载失败', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const toggleEnabled = async (item: Announcement) => {
    const pb = getPocketBase();
    try {
      await pb.collection('announcements').update(item.id, { enabled: !item.enabled });
      setItems((arr) => arr.map((a) => a.id === item.id ? { ...a, enabled: !a.enabled } : a));
      showToast(item.enabled ? '已停用' : '已启用', 'success');
    } catch (err) {
      console.error('切换公告状态失败:', err);
      showToast('操作失败', 'error');
    }
  };

  const saveItem = async () => {
    if (!editing) return;
    if (!editing.content.trim()) {
      showToast('公告内容必填', 'error');
      return;
    }
    setSaving(true);
    const pb = getPocketBase();
    try {
      const data = {
        title: editing.title || '',
        content: editing.content.trim(),
        type: editing.type,
        enabled: !!editing.enabled,
        start_at: editing.start_at ? fromInputDate(editing.start_at) : '',
        end_at: editing.end_at ? fromInputDate(editing.end_at) : '',
      };
      if (editing.id) {
        await pb.collection('announcements').update(editing.id, data);
      } else {
        await pb.collection('announcements').create(data);
      }
      setEditing(null);
      fetchItems();
      showToast('公告保存成功', 'success');
    } catch (err) {
      console.error('保存公告失败:', err);
      showToast('保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const deleteItem = async (id: string) => {
    const pb = getPocketBase();
    try {
      await pb.collection('announcements').delete(id);
      showToast('公告已删除', 'success');
      fetchItems();
    } catch (err) {
      console.error('删除公告失败:', err);
      showToast('删除失败', 'error');
    }
  };

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-secondary">共 {items.length} 条公告</p>
        <button onClick={() => setEditing({ ...emptyDraft })} className="btn-primary min-h-10 text-xs">+ 新建公告</button>
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-bg-soft" />)}</div>
      ) : items.length === 0 ? (
        <div className="card rounded-xl p-6 text-center text-text-secondary sm:p-12">没有公告，点击右上角创建。</div>
      ) : (
        <motion.div variants={listVariants} initial="hidden" animate="visible" className="space-y-3">
          {items.map((item) => (
            <motion.div key={item.id} layout variants={itemVariants} className="card flex min-w-0 items-start gap-3 rounded-xl p-4">
              <span className={cn('shrink-0 rounded-md border px-2 py-1 font-mono text-[10px] uppercase', typeStyles[item.type] || typeStyles.normal)}>
                {typeLabels[item.type] || item.type}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {item.title && <p className="break-words font-medium text-text [overflow-wrap:anywhere]">{item.title}</p>}
                  <span className={cn('rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase', item.enabled ? 'border-success/30 bg-success/10 text-success' : 'border-text-muted/30 bg-text-muted/10 text-text-secondary')}>
                    {item.enabled ? '启用' : '停用'}
                  </span>
                </div>
                <p className="mt-1 break-words text-sm text-text-secondary [overflow-wrap:anywhere]">{item.content}</p>
                <p className="mt-1 font-mono text-[10px] text-muted">{new Date(item.created).toLocaleString('zh-CN')}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button onClick={() => toggleEnabled(item)} title={item.enabled ? '停用' : '启用'} aria-label="切换启用" className="inline-flex h-10 w-10 items-center justify-center rounded-md text-text-secondary hover:bg-accent/10 hover:text-accent">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.enabled ? 'M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636' : 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'} /></svg>
                </button>
                <button onClick={() => setEditing({ ...item, start_at: toInputDate(item.start_at), end_at: toInputDate(item.end_at) })} className="inline-flex h-10 w-10 items-center justify-center rounded-md text-text-secondary hover:bg-accent/10 hover:text-accent" title="编辑" aria-label="编辑公告">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                </button>
                <button onClick={() => setConfirmState({ open: true, id: item.id })} className="inline-flex h-10 w-10 items-center justify-center rounded-md text-text-secondary hover:bg-danger/10 hover:text-danger" title="删除" aria-label="删除公告">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}

      <AnimatePresence>
        {editing && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-stretch justify-center overflow-y-auto glass-overlay p-0 sm:items-center sm:p-4" onClick={() => setEditing(null)}>
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} onClick={(e) => e.stopPropagation()} className="card flex min-h-[var(--vvh,100dvh)] w-full max-w-md flex-col overflow-hidden rounded-none p-5 sm:min-h-0 sm:rounded-lg sm:p-6">
              <h2 className="mb-6 break-words font-display text-lg font-bold uppercase tracking-wide text-text">{editing.id ? '编辑公告' : '新建公告'}</h2>
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">标题（可选）</label>
                  <input type="text" value={editing.title || ''} onChange={(e) => setEditing({ ...editing, title: e.target.value })} maxLength={200} className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-bg-soft px-4 py-2.5 text-sm text-text outline-none focus:border-accent" />
                </div>
                <div>
                  <label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">内容 *</label>
                  <textarea value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })} rows={3} maxLength={2000} className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-bg-soft px-4 py-2.5 text-sm text-text outline-none focus:border-accent" />
                </div>
                <div>
                  <label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">类型</label>
                  <select value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value as Announcement['type'] })} className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-bg-soft px-4 py-2.5 text-sm text-text outline-none focus:border-accent">
                    <option value="normal">普通</option>
                    <option value="info">信息</option>
                    <option value="warning">警告</option>
                    <option value="important">重要</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">开始时间</label>
                    <input type="datetime-local" value={editing.start_at || ''} onChange={(e) => setEditing({ ...editing, start_at: e.target.value })} className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-bg-soft px-3 py-2.5 text-sm text-text outline-none focus:border-accent" />
                  </div>
                  <div>
                    <label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">结束时间</label>
                    <input type="datetime-local" value={editing.end_at || ''} onChange={(e) => setEditing({ ...editing, end_at: e.target.value })} className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-bg-soft px-3 py-2.5 text-sm text-text outline-none focus:border-accent" />
                  </div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer text-sm text-text-secondary">
                  <input type="checkbox" checked={!!editing.enabled} onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })} className="h-4 w-4 rounded border-border accent-accent" />
                  <span>启用此公告</span>
                </label>
              </div>
              <div className="mt-6 flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
                <button onClick={() => setEditing(null)} className="btn-ghost min-h-10 text-xs">取消</button>
                <button onClick={saveItem} disabled={saving} className="btn-primary min-h-10 text-xs">{saving ? '保存中...' : '保存公告'}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={confirmState.open}
        title="确认删除"
        message="确定删除这条公告吗？"
        danger
        onConfirm={() => { deleteItem(confirmState.id); setConfirmState({ open: false, id: '' }); }}
        onCancel={() => setConfirmState({ open: false, id: '' })}
      />
    </div>
  );
}
