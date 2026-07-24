import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getPocketBase } from '../../lib/pocketbase';
import { showToast } from '../ui/Toast';
import ConfirmDialog from '../ui/ConfirmDialog';
import { cn } from '../../lib/utils';
import type { FriendLink } from '../../types/pocketbase';

type LinkDraft = Omit<FriendLink, 'id' | 'created' | 'updated'> & { id?: string };

const emptyDraft: LinkDraft = { name: '', url: '', description: '', avatar: '', status: 'show', sort_order: 0 };

const listVariants = {
  hidden: { opacity: 1 },
  visible: { transition: { staggerChildren: 0.04 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] } },
};

function isSafeUrl(url: string): boolean {
  try { const u = new URL(url); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
}

export default function FriendLinksManager() {
  const [links, setLinks] = useState<FriendLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<LinkDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmState, setConfirmState] = useState<{ open: boolean; id: string }>({ open: false, id: '' });

  const fetchLinks = useCallback(async () => {
    setLoading(true);
    const pb = getPocketBase();
    try {
      const result = await pb.collection('friend_links').getList<FriendLink>(1, 100, { sort: 'sort_order,-created' });
      setLinks(result.items);
    } catch (err) {
      console.error('获取友链失败:', err);
      showToast('友链加载失败', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchLinks(); }, [fetchLinks]);

  const saveLink = async () => {
    if (!editing) return;
    if (!editing.name.trim() || !editing.url.trim()) {
      showToast('名称和 URL 必填', 'error');
      return;
    }
    if (!isSafeUrl(editing.url)) {
      showToast('URL 必须是 http/https 开头', 'error');
      return;
    }
    setSaving(true);
    const pb = getPocketBase();
    try {
      const data = {
        name: editing.name.trim(),
        url: editing.url.trim(),
        description: editing.description || '',
        avatar: editing.avatar || '',
        status: editing.status,
        sort_order: Number(editing.sort_order) || 0,
      };
      if (editing.id) {
        await pb.collection('friend_links').update(editing.id, data);
      } else {
        await pb.collection('friend_links').create(data);
      }
      setEditing(null);
      fetchLinks();
      showToast('友链保存成功', 'success');
    } catch (err) {
      console.error('保存友链失败:', err);
      showToast('保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const deleteLink = async (id: string) => {
    const pb = getPocketBase();
    try {
      await pb.collection('friend_links').delete(id);
      showToast('友链已删除', 'success');
      fetchLinks();
    } catch (err) {
      console.error('删除友链失败:', err);
      showToast('删除失败', 'error');
    }
  };

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-secondary">共 {links.length} 个友链</p>
        <button onClick={() => setEditing({ ...emptyDraft })} className="btn-primary min-h-10 text-xs">+ 新建友链</button>
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-bg-soft" />)}</div>
      ) : links.length === 0 ? (
        <div className="card rounded-xl p-6 text-center text-text-secondary sm:p-12">没有友链，点击右上角添加第一个。</div>
      ) : (
        <motion.div variants={listVariants} initial="hidden" animate="visible" className="space-y-3">
          {links.map((link) => (
            <motion.div key={link.id} layout variants={itemVariants} className="card flex min-w-0 items-center gap-3 rounded-xl p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-bg-soft font-bold text-text-secondary">
                {link.avatar && isSafeUrl(link.avatar) ? (
                  <img src={link.avatar} alt="" className="h-full w-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                ) : (
                  link.name?.charAt(0)?.toUpperCase() || '?'
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="break-words font-medium text-text [overflow-wrap:anywhere]">{link.name}</p>
                  <span className={cn('rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase', link.status === 'show' ? 'border-success/30 bg-success/10 text-success' : 'border-text-muted/30 bg-text-muted/10 text-text-secondary')}>
                    {link.status === 'show' ? '显示' : '隐藏'}
                  </span>
                  {link.sort_order ? <span className="font-mono text-[10px] text-muted">序号 {link.sort_order}</span> : null}
                </div>
                <p className="break-all font-mono text-[10px] text-muted [overflow-wrap:anywhere]">{link.url}</p>
                {link.description && <p className="mt-0.5 break-words text-xs text-text-secondary [overflow-wrap:anywhere]">{link.description}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button onClick={() => setEditing({ ...link })} className="inline-flex h-10 w-10 items-center justify-center rounded-md text-text-secondary hover:bg-accent/10 hover:text-accent" title="编辑" aria-label="编辑友链">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                </button>
                <button onClick={() => setConfirmState({ open: true, id: link.id })} className="inline-flex h-10 w-10 items-center justify-center rounded-md text-text-secondary hover:bg-danger/10 hover:text-danger" title="删除" aria-label="删除友链">
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
              <h2 className="mb-6 break-words font-display text-lg font-bold uppercase tracking-wide text-text">{editing.id ? '编辑友链' : '新建友链'}</h2>
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">名称 *</label>
                  <input type="text" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-bg-soft px-4 py-2.5 text-sm text-text outline-none focus:border-accent" />
                </div>
                <div>
                  <label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">URL *</label>
                  <input type="url" value={editing.url} onChange={(e) => setEditing({ ...editing, url: e.target.value })} placeholder="https://example.com" className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-bg-soft px-4 py-2.5 font-mono text-sm text-text outline-none focus:border-accent" />
                </div>
                <div>
                  <label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">头像 URL（可选）</label>
                  <input type="url" value={editing.avatar || ''} onChange={(e) => setEditing({ ...editing, avatar: e.target.value })} placeholder="https://...favicon" className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-bg-soft px-4 py-2.5 font-mono text-sm text-text outline-none focus:border-accent" />
                </div>
                <div>
                  <label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">描述</label>
                  <textarea value={editing.description || ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} rows={2} className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-bg-soft px-4 py-2.5 text-sm text-text outline-none focus:border-accent" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">状态</label>
                    <select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value as 'show' | 'hide' })} className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-bg-soft px-4 py-2.5 text-sm text-text outline-none focus:border-accent">
                      <option value="show">显示</option>
                      <option value="hide">隐藏</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">排序</label>
                    <input type="number" value={editing.sort_order ?? 0} onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) })} className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-bg-soft px-4 py-2.5 font-mono text-sm text-text outline-none focus:border-accent" />
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
        title="确认删除"
        message="确定删除这个友链吗？"
        danger
        onConfirm={() => { deleteLink(confirmState.id); setConfirmState({ open: false, id: '' }); }}
        onCancel={() => setConfirmState({ open: false, id: '' })}
      />
    </div>
  );
}
