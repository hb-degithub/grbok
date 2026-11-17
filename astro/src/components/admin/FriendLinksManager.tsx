import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { showToast } from '../ui/Toast';
import ConfirmDialog from '../ui/ConfirmDialog';
import { useFriendLinks } from '../../hooks/domains/useFriendLinks';
import type { FriendLink } from '../../types/pocketbase';

/* ===========================
   友链管理（后台）
   - 只用 --sf-* 令牌：surface/canvas + 四档细线 + 三档墨色 + 单一强调色；
   - 圆角统一 3px（徽标/头像 2px），列表靠 1px 细线分隔，行 hover 只改底色；
   - 状态色只用于语义：显示中 emerald、已隐藏 ink-3、删除 --sf-danger；
   - 弹窗为实底表面 + 细线，主按钮强调色实底 + --sf-on-accent。
   CRUD、上下架、排序字段与确认删除流程与改造前一致。
   =========================== */

type Tone = 'neutral' | 'success';

const TONE_CHIP: Record<Tone, string> = {
  neutral: 'border-[var(--sf-line)] text-[var(--sf-ink-3)]',
  success: 'border-emerald-600/45 text-emerald-700 dark:border-emerald-400/45 dark:text-emerald-300',
};

const BTN_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-[3px] border font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)] disabled:cursor-not-allowed disabled:opacity-50';
const BTN_PRIMARY =
  'border-[var(--sf-accent)] bg-[var(--sf-accent)] text-[var(--sf-on-accent)] hover:border-[var(--sf-accent-ink)] hover:bg-[var(--sf-accent-ink)]';
const BTN_SECONDARY =
  'border-[var(--sf-line-control)] bg-[var(--sf-surface)] text-[var(--sf-ink)] hover:border-[var(--sf-accent)] hover:text-[var(--sf-accent-ink)]';
const BTN_GHOST =
  'border-transparent bg-transparent text-[var(--sf-ink-2)] hover:border-[var(--sf-line)] hover:bg-[var(--sf-line-soft)] hover:text-[var(--sf-ink)]';
const BTN_GHOST_DANGER =
  'border-transparent bg-transparent text-[var(--sf-ink-2)] hover:border-[var(--sf-danger)] hover:bg-[var(--sf-line-soft)] hover:text-[var(--sf-danger)]';
const BTN_MD = 'min-h-10 px-3 text-[13px]';
const BTN_ICON = 'h-9 w-9 shrink-0';

/** 与 ui/Input.tsx 同一套输入样式：surface 底 + 控制线 + 强调色焦点环。 */
const INPUT =
  'min-h-[40px] w-full min-w-0 rounded-[3px] border border-[var(--sf-line-control)] bg-[var(--sf-surface)] px-3 text-[13px] text-[var(--sf-ink)] outline-none transition-colors placeholder:text-[var(--sf-ink-3)] focus-visible:border-[var(--sf-accent)] focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)] focus-visible:ring-offset-0';
const LABEL = 'mb-1 block font-mono text-[11px] tracking-[0.08em] text-[var(--sf-ink-3)]';

const TABLE_HEAD =
  'border-b border-[var(--sf-line)] bg-[var(--sf-canvas)] text-left font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--sf-ink-3)]';
const TABLE_ROW = 'border-b border-[var(--sf-line-soft)] transition-colors last:border-b-0 hover:bg-[var(--sf-canvas)]';
const TH = 'whitespace-nowrap px-3 py-2 font-medium';
const TD = 'px-3 py-2.5 align-middle';

function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

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
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-[11px] tracking-[0.08em] text-[var(--sf-ink-3)]">共 {links.length} 个友链</p>
        <button type="button" onClick={openCreate} className={cx(BTN_BASE, BTN_PRIMARY, BTN_MD)}>+ 新建友链</button>
      </div>

      {loading ? (
        <div className="overflow-hidden rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)]" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse border-b border-[var(--sf-line-soft)] bg-[var(--sf-canvas)] last:border-b-0" />
          ))}
        </div>
      ) : links.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] px-3 py-10 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--sf-ink-3)]">EMPTY / 0</p>
          <p className="text-[13px] text-[var(--sf-ink-2)]">没有找到友链。</p>
        </div>
      ) : (
        <div className="min-w-0 overflow-x-auto rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)]">
          <table className="w-full min-w-[40rem] border-collapse text-[13px]">
            <caption className="sr-only">友情链接列表</caption>
            <thead>
              <tr className={TABLE_HEAD}>
                <th scope="col" className={TH}>站点</th>
                <th scope="col" className={TH}>状态</th>
                <th scope="col" className={TH}>排序</th>
                <th scope="col" className={cx(TH, 'text-right')}>操作</th>
              </tr>
            </thead>
            <tbody>
              {links.map((link) => (
                <tr key={link.id} className={TABLE_ROW}>
                  <td className={cx(TD, 'min-w-[16rem]')}>
                    <div className="flex min-w-0 items-start gap-2.5">
                      {link.avatar && (
                        <img
                          src={link.avatar}
                          alt={link.name}
                          className="h-9 w-9 shrink-0 rounded-[2px] border border-[var(--sf-line)] object-cover"
                          loading="lazy"
                        />
                      )}
                      <div className="min-w-0">
                        <p className="break-words font-medium text-[var(--sf-ink)] [overflow-wrap:anywhere]">{link.name}</p>
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-0.5 block break-all font-mono text-[11px] text-[var(--sf-accent)] transition-colors hover:text-[var(--sf-accent-ink)] hover:underline [overflow-wrap:anywhere]"
                        >
                          {link.url}
                        </a>
                        {link.description && (
                          <p className="mt-0.5 line-clamp-2 break-words text-[12px] leading-snug text-[var(--sf-ink-2)] [overflow-wrap:anywhere]">{link.description}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className={TD}>
                    <span
                      className={cx(
                        'inline-flex items-center gap-1 rounded-[2px] border px-1.5 py-0.5 font-mono text-[10px] leading-none tracking-[0.08em]',
                        link.status === 'show' ? TONE_CHIP.success : TONE_CHIP.neutral
                      )}
                    >
                      {link.status === 'show' ? '显示' : '隐藏'}
                    </span>
                  </td>
                  <td className={cx(TD, 'whitespace-nowrap font-mono text-[11px] text-[var(--sf-ink-3)]')}>排序: {link.sort_order ?? 0}</td>
                  <td className={cx(TD, 'text-right')}>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => toggleStatus(link)}
                        className={cx(BTN_BASE, BTN_GHOST, BTN_ICON)}
                        title={link.status === 'show' ? '隐藏' : '显示'}
                        aria-label={link.status === 'show' ? '隐藏友链' : '显示友链'}
                      >
                        {link.status === 'show' ? (
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                        ) : (
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => openEdit(link)}
                        className={cx(BTN_BASE, BTN_GHOST, BTN_ICON)}
                        title="编辑友链"
                        aria-label="编辑友链"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteLink(link.id)}
                        className={cx(BTN_BASE, BTN_GHOST_DANGER, BTN_ICON)}
                        title="删除友链"
                        aria-label="删除友链"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AnimatePresence>
        {editing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-stretch justify-center overflow-y-auto bg-[var(--sf-scrim)] p-0 sm:items-center sm:p-4"
            onClick={() => setEditing(null)}
          >
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="friend-link-dialog-title"
              className="flex min-h-[var(--vvh,100dvh)] w-full max-w-md flex-col overflow-hidden rounded-none border border-[var(--sf-line)] bg-[var(--sf-surface)] p-5 sm:min-h-0 sm:rounded-[3px] sm:p-6"
            >
              <div className="mb-5 flex items-center gap-2 border-b border-[var(--sf-line)] pb-3">
                <span className="font-mono text-[10px] tracking-[0.2em] text-[var(--sf-ink-3)]">{editing.id ? 'EDIT' : 'NEW'}</span>
                <h2 id="friend-link-dialog-title" className="break-words text-sm font-semibold tracking-tight text-[var(--sf-ink)] [overflow-wrap:anywhere]">
                  {editing.id ? '编辑友链' : '新建友链'}
                </h2>
                <span className="ml-1 h-px min-w-4 flex-1 bg-[var(--sf-line)]" aria-hidden="true" />
              </div>
              <div className="space-y-4">
                <div>
                  <label htmlFor="friend-link-name" className={LABEL}>名称 <span className="text-[var(--sf-danger)]">*</span></label>
                  <input
                    id="friend-link-name"
                    type="text"
                    value={editing.name || ''}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    className={INPUT}
                    placeholder="网站名称"
                  />
                </div>
                <div>
                  <label htmlFor="friend-link-url" className={LABEL}>URL <span className="text-[var(--sf-danger)]">*</span></label>
                  <input
                    id="friend-link-url"
                    type="text"
                    value={editing.url || ''}
                    onChange={(e) => setEditing({ ...editing, url: e.target.value })}
                    className={cx(INPUT, 'font-mono text-[12px]')}
                    placeholder="https://example.com"
                  />
                </div>
                <div>
                  <label htmlFor="friend-link-description" className={LABEL}>描述</label>
                  <textarea
                    id="friend-link-description"
                    value={editing.description || ''}
                    onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                    rows={3}
                    className={cx(INPUT, 'py-2 leading-relaxed')}
                    placeholder="简短描述"
                  />
                </div>
                <div>
                  <label htmlFor="friend-link-avatar" className={LABEL}>头像 URL</label>
                  <input
                    id="friend-link-avatar"
                    type="text"
                    value={editing.avatar || ''}
                    onChange={(e) => setEditing({ ...editing, avatar: e.target.value })}
                    className={cx(INPUT, 'font-mono text-[12px]')}
                    placeholder="https://example.com/avatar.png"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="friend-link-status" className={LABEL}>状态</label>
                    <select
                      id="friend-link-status"
                      value={editing.status || 'show'}
                      onChange={(e) => setEditing({ ...editing, status: e.target.value as 'show' | 'hide' })}
                      className={INPUT}
                    >
                      <option value="show">显示</option>
                      <option value="hide">隐藏</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="friend-link-sort" className={LABEL}>排序</label>
                    <input
                      id="friend-link-sort"
                      type="number"
                      value={typeof editing.sort_order === 'number' ? editing.sort_order : 0}
                      onChange={(e) => setEditing({ ...editing, sort_order: parseInt(e.target.value, 10) || 0 })}
                      className={INPUT}
                    />
                  </div>
                </div>
              </div>
              <div className="mt-6 flex flex-col-reverse gap-2 border-t border-[var(--sf-line)] pt-4 sm:flex-row sm:justify-end">
                <button type="button" onClick={() => setEditing(null)} className={cx(BTN_BASE, BTN_SECONDARY, BTN_MD)}>取消</button>
                <button type="button" onClick={saveLink} disabled={saving} className={cx(BTN_BASE, BTN_PRIMARY, BTN_MD)}>{saving ? '保存中...' : '保存友链'}</button>
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
