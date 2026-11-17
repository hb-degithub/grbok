import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAdminTags } from '../../hooks/domains/useAdminTags';
import { showToast } from '../ui/Toast';
import ConfirmDialog from '../ui/ConfirmDialog';
import type { Tag } from '../../lib/services/adminTagService';

/* ===========================
   标签管理（后台）
   - 只用 --sf-* 令牌：surface/canvas + 四档细线 + 三档墨色 + 单一强调色；
   - 圆角统一 3px，列表靠 1px 细线分隔，行 hover 只改底色；
   - 删除走 --sf-danger 细线按钮 + ConfirmDialog 确认；
   - 弹窗为实底表面 + 细线，主按钮强调色实底 + --sf-on-accent。
   CRUD、slug 回退规则与确认删除流程与改造前一致。
   =========================== */

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
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-[11px] tracking-[0.08em] text-[var(--sf-ink-3)]">共 {tags.length} 个标签</p>
        <button type="button" onClick={() => setEditing({ id: '', name: '', slug: '', description: '' })} className={cx(BTN_BASE, BTN_PRIMARY, BTN_MD)}>+ 新建标签</button>
      </div>

      {loading ? (
        <div className="overflow-hidden rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)]" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse border-b border-[var(--sf-line-soft)] bg-[var(--sf-canvas)] last:border-b-0" />
          ))}
        </div>
      ) : tags.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] px-3 py-10 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--sf-ink-3)]">EMPTY / 0</p>
          <p className="text-[13px] text-[var(--sf-ink-2)]">没有找到标签。</p>
        </div>
      ) : (
        <div className="min-w-0 overflow-x-auto rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)]">
          <table className="w-full min-w-[30rem] border-collapse text-[13px]">
            <caption className="sr-only">标签列表</caption>
            <thead>
              <tr className={TABLE_HEAD}>
                <th scope="col" className={TH}>名称</th>
                <th scope="col" className={TH}>Slug</th>
                <th scope="col" className={cx(TH, 'text-right')}>操作</th>
              </tr>
            </thead>
            <tbody>
              {tags.map((tag) => (
                <tr key={tag.id} className={TABLE_ROW}>
                  <td className={cx(TD, 'min-w-[10rem]')}>
                    <p className="break-words font-medium text-[var(--sf-ink)] [overflow-wrap:anywhere]">{tag.name}</p>
                  </td>
                  <td className={cx(TD, 'whitespace-nowrap font-mono text-[11px] text-[var(--sf-accent)]')}>/{tag.slug}</td>
                  <td className={cx(TD, 'text-right')}>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setEditing(tag)}
                        className={cx(BTN_BASE, BTN_GHOST, BTN_ICON)}
                        title="编辑标签"
                        aria-label="编辑标签"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(tag.id)}
                        className={cx(BTN_BASE, BTN_GHOST_DANGER, BTN_ICON)}
                        title="删除标签"
                        aria-label="删除标签"
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
              aria-labelledby="tag-dialog-title"
              className="flex min-h-[var(--vvh,100dvh)] w-full max-w-md flex-col overflow-hidden rounded-none border border-[var(--sf-line)] bg-[var(--sf-surface)] p-5 sm:min-h-0 sm:rounded-[3px] sm:p-6"
            >
              <div className="mb-5 flex items-center gap-2 border-b border-[var(--sf-line)] pb-3">
                <span className="font-mono text-[10px] tracking-[0.2em] text-[var(--sf-ink-3)]">{editing.id ? 'EDIT' : 'NEW'}</span>
                <h2 id="tag-dialog-title" className="break-words text-sm font-semibold tracking-tight text-[var(--sf-ink)] [overflow-wrap:anywhere]">
                  {editing.id ? '编辑标签' : '新建标签'}
                </h2>
                <span className="ml-1 h-px min-w-4 flex-1 bg-[var(--sf-line)]" aria-hidden="true" />
              </div>
              <div className="space-y-4">
                <div>
                  <label htmlFor="tag-name" className={LABEL}>名称</label>
                  <input
                    id="tag-name"
                    type="text"
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    className={INPUT}
                  />
                </div>
                <div>
                  <label htmlFor="tag-slug" className={LABEL}>Slug</label>
                  <input
                    id="tag-slug"
                    type="text"
                    value={editing.slug}
                    onChange={(e) => setEditing({ ...editing, slug: e.target.value })}
                    className={cx(INPUT, 'font-mono text-[12px]')}
                  />
                </div>
                <div>
                  <label htmlFor="tag-description" className={LABEL}>描述</label>
                  <textarea
                    id="tag-description"
                    value={editing.description || ''}
                    onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                    rows={3}
                    className={cx(INPUT, 'py-2 leading-relaxed')}
                  />
                </div>
              </div>
              <div className="mt-6 flex flex-col-reverse gap-2 border-t border-[var(--sf-line)] pt-4 sm:flex-row sm:justify-end">
                <button type="button" onClick={() => setEditing(null)} className={cx(BTN_BASE, BTN_SECONDARY, BTN_MD)}>取消</button>
                <button type="button" onClick={saveTag} disabled={saving} className={cx(BTN_BASE, BTN_PRIMARY, BTN_MD)}>{saving ? '保存中...' : '保存标签'}</button>
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
