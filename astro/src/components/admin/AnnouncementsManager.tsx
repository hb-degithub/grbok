import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAnnouncements } from '../../hooks/domains/useAnnouncements';
import { showToast } from '../ui/Toast';
import ConfirmDialog from '../ui/ConfirmDialog';
import type { Announcement } from '../../types/pocketbase';

const typeStyles: Record<string, string> = {
  info: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200',
  warning: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  important: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200',
  normal: 'border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300',
};

const typeLabels: Record<string, string> = {
  normal: '普通',
  info: '信息',
  warning: '警告',
  important: '重要',
};

function cn(...classes: (string | false | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

export default function AnnouncementsManager() {
  const [editing, setEditing] = useState<Partial<Announcement> | null>(null);
  const [confirmState, setConfirmState] = useState<{ open: boolean; title: string; message: string; onConfirm: () => void }>({ open: false, title: '', message: '', onConfirm: () => {} });
  const { announcements, loading, saving, saveAnnouncement, deleteAnnouncement, toggleEnabled } = useAnnouncements();

  const validate = (data: Partial<Announcement>): string | null => {
    if (!data.title?.trim()) return '标题不能为空';
    if (!data.content?.trim()) return '内容不能为空';
    if (data.start_at && data.end_at && new Date(data.start_at) > new Date(data.end_at)) {
      return '结束时间不能早于开始时间';
    }
    return null;
  };

  const handleSave = async () => {
    if (!editing) return;
    const error = validate(editing);
    if (error) { showToast(error, 'error'); return; }
    const result = await saveAnnouncement(editing);
    if (result.success) {
      setEditing(null);
    }
  };

  const handleDelete = (id: string) => {
    setConfirmState({
      open: true,
      title: '确认删除',
      message: '确定删除这条公告吗？此操作不可撤销。',
      onConfirm: async () => {
        await deleteAnnouncement(id);
      }
    });
  };

  const openCreate = () => {
    setEditing({
      id: '',
      title: '',
      content: '',
      type: 'normal',
      enabled: true,
      start_at: '',
      end_at: '',
    });
  };

  const openEdit = (item: Announcement) => {
    setEditing({
      ...item,
      start_at: item.start_at ? new Date(item.start_at).toISOString().slice(0, 16) : '',
      end_at: item.end_at ? new Date(item.end_at).toISOString().slice(0, 16) : '',
    });
  };

  const formatDate = (value?: string) => {
    if (!value) return '-';
    const d = new Date(value);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-secondary">共 {announcements.length} 条公告</p>
        <button onClick={openCreate} className="btn-primary min-h-10 text-xs">+ 新建公告</button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-bg-soft" />
          ))}
        </div>
      ) : announcements.length === 0 ? (
        <div className="card rounded-xl p-6 text-center text-text-secondary sm:p-12">没有找到公告。</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {announcements.map((item) => (
            <motion.div
              key={item.id}
              layout
              className="card flex min-w-0 flex-col gap-3 rounded-xl p-4"
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="break-words font-medium text-text [overflow-wrap:anywhere]">{item.title}</p>
                    <span className={cn('inline-flex shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]', typeStyles[item.type] || typeStyles.normal)}>
                      {typeLabels[item.type] || '普通'}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-text-secondary">{item.content}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted">
                <span>开始: {formatDate(item.start_at)}</span>
                <span>结束: {formatDate(item.end_at)}</span>
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleEnabled(item)}
                    className={cn(
                      'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                      item.enabled ? 'bg-accent' : 'bg-muted/40'
                    )}
                    title={item.enabled ? '点击禁用' : '点击启用'}
                  >
                    <span
                      className={cn(
                        'inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform',
                        item.enabled ? 'translate-x-4.5' : 'translate-x-1'
                      )}
                    />
                  </button>
                  <span className={cn('text-[10px] font-mono', item.enabled ? 'text-success' : 'text-muted')}>{item.enabled ? '已启用' : '已禁用'}</span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => openEdit(item)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md text-text-secondary hover:bg-accent/10 hover:text-accent"
                    title="编辑公告"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                  </button>
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md text-text-secondary hover:bg-danger/10 hover:text-danger"
                    title="删除公告"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {editing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-stretch justify-center overflow-y-auto glass-overlay p-0 sm:items-center sm:p-4"
            onClick={() => setEditing(null)}
          >
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="card flex min-h-[var(--vvh,100dvh)] w-full max-w-md flex-col overflow-hidden rounded-none p-5 sm:min-h-0 sm:rounded-lg sm:p-6"
            >
              <h2 className="mb-6 break-words font-display text-lg font-bold uppercase tracking-wide text-text [overflow-wrap:anywhere]">
                {editing.id ? '编辑公告' : '新建公告'}
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">标题 <span className="text-danger">*</span></label>
                  <input
                    type="text"
                    value={editing.title || ''}
                    onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                    className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-bg-soft px-4 py-2.5 text-sm text-text outline-none focus:border-accent"
                    placeholder="公告标题"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">内容 <span className="text-danger">*</span></label>
                  <textarea
                    value={editing.content || ''}
                    onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                    rows={4}
                    className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-bg-soft px-4 py-2.5 text-sm text-text outline-none focus:border-accent"
                    placeholder="公告内容"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">类型</label>
                    <select
                      value={editing.type || 'normal'}
                      onChange={(e) => setEditing({ ...editing, type: e.target.value as Announcement['type'] })}
                      className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-bg-soft px-4 py-2.5 text-sm text-text outline-none focus:border-accent"
                    >
                      <option value="normal">普通</option>
                      <option value="info">信息</option>
                      <option value="warning">警告</option>
                      <option value="important">重要</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">状态</label>
                    <select
                      value={editing.enabled ? 'true' : 'false'}
                      onChange={(e) => setEditing({ ...editing, enabled: e.target.value === 'true' })}
                      className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-bg-soft px-4 py-2.5 text-sm text-text outline-none focus:border-accent"
                    >
                      <option value="true">启用</option>
                      <option value="false">禁用</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">开始时间</label>
                    <input
                      type="datetime-local"
                      value={editing.start_at || ''}
                      onChange={(e) => setEditing({ ...editing, start_at: e.target.value })}
                      className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-bg-soft px-4 py-2.5 text-sm text-text outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">结束时间</label>
                    <input
                      type="datetime-local"
                      value={editing.end_at || ''}
                      onChange={(e) => setEditing({ ...editing, end_at: e.target.value })}
                      className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-bg-soft px-4 py-2.5 text-sm text-text outline-none focus:border-accent"
                    />
                  </div>
                </div>
              </div>
              <div className="mt-6 flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
                <button onClick={() => setEditing(null)} className="btn-ghost min-h-10 text-xs">取消</button>
                <button onClick={handleSave} disabled={saving} className="btn-primary min-h-10 text-xs">{saving ? '保存中...' : '保存公告'}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        message={confirmState.message}
        danger
        onConfirm={() => { confirmState.onConfirm(); setConfirmState(s => ({ ...s, open: false })); }}
        onCancel={() => setConfirmState(s => ({ ...s, open: false }))}
      />
    </div>
  );
}