import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAdminTags } from '../../hooks/domains/useAdminTags';
import { showToast } from '../ui/Toast';
import ConfirmDialog from '../ui/ConfirmDialog';
import type { Tag } from '../../lib/services/adminTagService';

export default function TagManager() {
  const {
    tags,
    loading,
    editing,
    saving,
    setEditing,
    saveTag,
    deleteTag,
  } = useAdminTags();

  const [confirmState, setConfirmState] = useState<{ open: boolean; title: string; message: string; onConfirm: () => void }>({ open: false, title: '', message: '', onConfirm: () => {} });

  const handleDelete = (id: string) => {
    setConfirmState({
      open: true,
      title: '确认删除',
      message: '确定删除这个标签吗？',
      onConfirm: () => deleteTag(id),
    });
  };

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-secondary">共 {tags.length} 个标签</p>
        <button onClick={() => setEditing({ id: '', name: '', slug: '', description: '' })} className="btn-primary min-h-10 text-xs">+ 新建标签</button>
      </div>
      {loading ? <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-bg-soft" />)}</div>
      : tags.length === 0 ? <div className="card rounded-xl p-6 text-center text-text-secondary sm:p-12">没有找到标签。</div>
      : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tags.map((tag) => (
            <motion.div key={tag.id} layout className="card flex min-w-0 items-start justify-between gap-3 rounded-xl p-4">
              <div className="min-w-0 flex-1"><p className="break-words font-medium text-text [overflow-wrap:anywhere]">{tag.name}</p><p className="break-all font-mono text-[10px] text-muted [overflow-wrap:anywhere]">/{tag.slug}</p></div>
              <div className="flex shrink-0 items-center gap-1">
                <button onClick={() => setEditing(tag)} className="inline-flex h-10 w-10 items-center justify-center rounded-md text-text-secondary hover:bg-accent/10 hover:text-accent" title="编辑标签"><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg></button>
                <button onClick={() => handleDelete(tag.id)} className="inline-flex h-10 w-10 items-center justify-center rounded-md text-text-secondary hover:bg-danger/10 hover:text-danger" title="删除标签"><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
              </div>
            </motion.div>
          ))}
        </div>
      }
      <AnimatePresence>
        {editing && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-stretch justify-center overflow-y-auto glass-overlay p-0 sm:items-center sm:p-4" onClick={() => setEditing(null)}>
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} onClick={(e) => e.stopPropagation()} className="card flex min-h-[var(--vvh,100dvh)] w-full max-w-md flex-col overflow-hidden rounded-none p-5 sm:min-h-0 sm:rounded-lg sm:p-6">
              <h2 className="mb-6 break-words font-display text-lg font-bold uppercase tracking-wide text-text [overflow-wrap:anywhere]">{editing.id ? '编辑标签' : '新建标签'}</h2>
              <div className="space-y-4">
                <div><label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">名称</label>
                  <input type="text" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-bg-soft px-4 py-2.5 text-sm text-text outline-none focus:border-accent" /></div>
                <div><label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">Slug</label>
                  <input type="text" value={editing.slug} onChange={(e) => setEditing({ ...editing, slug: e.target.value })} className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-bg-soft px-4 py-2.5 font-mono text-sm text-text outline-none focus:border-accent" /></div>
                <div><label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">描述</label>
                  <textarea value={editing.description || ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} rows={3} className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-bg-soft px-4 py-2.5 text-sm text-text outline-none focus:border-accent" /></div>
              </div>
              <div className="mt-6 flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
                <button onClick={() => setEditing(null)} className="btn-ghost min-h-10 text-xs">取消</button>
                <button onClick={saveTag} disabled={saving} className="btn-primary min-h-10 text-xs">{saving ? '保存中...' : '保存标签'}</button>
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