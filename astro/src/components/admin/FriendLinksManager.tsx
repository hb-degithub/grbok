import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { showToast } from '../ui/Toast';
import ConfirmDialog from '../ui/ConfirmDialog';
import { useFriendLinks } from '../../hooks/domains/useFriendLinks';
import type { FriendLink } from '../../types/pocketbase';

export default function FriendLinksManager() {
  const { links, loading, saving, saveLink: saveLinkService, deleteLink: deleteLinkService, toggleStatus: toggleStatusService } = useFriendLinks();
  const [editing, setEditing] = useState<Partial<FriendLink> | null>(null);
  const [confirmState, setConfirmState] = useState<{ open: boolean; title: string; message: string; onConfirm: () => void }>({ open: false, title: '', message: '', onConfirm: () => {} });

  const saveLink = async () => {
    if (!editing) return;
    const success = await saveLinkService(editing);
    if (success) {
      setEditing(null);
    }
  };

  const deleteLink = (id: string) => {
    setConfirmState({
      open: true,
      title: '确认删除',
      message: '确定删除这个友链吗？此操作不可撤销。',
      onConfirm: async () => {
        await deleteLinkService(id);
      }
    });
  };

  const toggleStatus = async (link: FriendLink) => {
    const success = await toggleStatusService(link);
    if (success) {
      showToast(`已${link.status === 'show' ? '隐藏' : '显示'}`, 'success');
    }
  };

  const openCreate = () => {
    setEditing({
      id: '',
      name: '',
      url: '',
      description: '',
      avatar: '',
      status: 'show',
      sort_order: links.length,
    });
  };

  const openEdit = (link: FriendLink) => {
    setEditing({ ...link });
  };

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-secondary">共 {links.length} 个友链</p>
        <button onClick={openCreate} className="btn-primary min-h-10 text-xs">+ 新建友链</button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-bg-soft" />
          ))}
        </div>
      ) : links.length === 0 ? (
        <div className="card rounded-xl p-6 text-center text-text-secondary sm:p-12">没有找到友链。</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {links.map((link) => (
            <motion.div
              key={link.id}
              layout
              className="card flex min-w-0 flex-col gap-3 rounded-xl p-4"
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="break-words font-medium text-text [overflow-wrap:anywhere]">{link.name}</p>
                    <span className={cn(
                      'inline-flex shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]',
                      link.status === 'show'
                        ? 'border border-success/25 bg-success/10 text-success'
                        : 'border border-muted/25 bg-muted/10 text-muted'
                    )}>
                      {link.status === 'show' ? '显示' : '隐藏'}
                    </span>
                  </div>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-0.5 block break-all font-mono text-[10px] text-accent hover:underline [overflow-wrap:anywhere]"
                  >
                    {link.url}
                  </a>
                  {link.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-text-secondary">{link.description}</p>
                  )}
                </div>
                {link.avatar && (
                  <img
                    src={link.avatar}
                    alt={link.name}
                    className="h-10 w-10 shrink-0 rounded-lg object-cover"
                    loading="lazy"
                  />
                )}
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
                <span className="font-mono text-[10px] text-muted">排序: {link.sort_order ?? 0}</span>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => toggleStatus(link)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md text-text-secondary hover:bg-accent/10 hover:text-accent"
                    title={link.status === 'show' ? '隐藏' : '显示'}
                  >
                    {link.status === 'show' ? (
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                    ) : (
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                    )}
                  </button>
                  <button
                    onClick={() => openEdit(link)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md text-text-secondary hover:bg-accent/10 hover:text-accent"
                    title="编辑友链"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                  </button>
                  <button
                    onClick={() => deleteLink(link.id)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md text-text-secondary hover:bg-danger/10 hover:text-danger"
                    title="删除友链"
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
                {editing.id ? '编辑友链' : '新建友链'}
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">名称 <span className="text-danger">*</span></label>
                  <input
                    type="text"
                    value={editing.name || ''}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-bg-soft px-4 py-2.5 text-sm text-text outline-none focus:border-accent"
                    placeholder="网站名称"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">URL <span className="text-danger">*</span></label>
                  <input
                    type="text"
                    value={editing.url || ''}
                    onChange={(e) => setEditing({ ...editing, url: e.target.value })}
                    className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-bg-soft px-4 py-2.5 font-mono text-sm text-text outline-none focus:border-accent"
                    placeholder="https://example.com"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">描述</label>
                  <textarea
                    value={editing.description || ''}
                    onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                    rows={3}
                    className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-bg-soft px-4 py-2.5 text-sm text-text outline-none focus:border-accent"
                    placeholder="简短描述"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">头像 URL</label>
                  <input
                    type="text"
                    value={editing.avatar || ''}
                    onChange={(e) => setEditing({ ...editing, avatar: e.target.value })}
                    className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-bg-soft px-4 py-2.5 font-mono text-sm text-text outline-none focus:border-accent"
                    placeholder="https://example.com/avatar.png"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">状态</label>
                    <select
                      value={editing.status || 'show'}
                      onChange={(e) => setEditing({ ...editing, status: e.target.value as 'show' | 'hide' })}
                      className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-bg-soft px-4 py-2.5 text-sm text-text outline-none focus:border-accent"
                    >
                      <option value="show">显示</option>
                      <option value="hide">隐藏</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">排序</label>
                    <input
                      type="number"
                      value={typeof editing.sort_order === 'number' ? editing.sort_order : 0}
                      onChange={(e) => setEditing({ ...editing, sort_order: parseInt(e.target.value, 10) || 0 })}
                      className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-bg-soft px-4 py-2.5 text-sm text-text outline-none focus:border-accent"
                    />
                  </div>
                </div>
              </div>
              <div className="mt-6 flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
                <button onClick={() => setEditing(null)} className="btn-ghost min-h-10 text-xs">取消</button>
                <button onClick={saveLink} disabled={saving} className="btn-primary min-h-10 text-xs">{saving ? '保存中...' : '保存友链'}</button>
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

function cn(...classes: (string | false | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}
