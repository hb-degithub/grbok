import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAnnouncements } from '../../hooks/domains/useAnnouncements';
import { showToast } from '../ui/Toast';
import ConfirmDialog from '../ui/ConfirmDialog';
import type { Announcement } from '../../types/pocketbase';

/* ===========================
   公告管理（后台）
   - 只用 --sf-* 令牌：surface/canvas + 四档细线 + 三档墨色 + 单一强调色；
   - 圆角统一 3px（徽标 2px），列表靠 1px 细线分隔，行 hover 只改底色；
   - 状态色只用于语义：已启用 emerald、已禁用 ink-3、重要 --sf-danger、警告 amber；
   - 弹窗为实底表面 + 细线，主按钮强调色实底 + --sf-on-accent。
   CRUD、校验文案、启用开关与确认删除流程与改造前一致。
   =========================== */

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const TONE_CHIP: Record<Tone, string> = {
  neutral: 'border-[var(--sf-line)] text-[var(--sf-ink-3)]',
  accent: 'border-[var(--sf-accent)] text-[var(--sf-accent)]',
  success: 'border-emerald-600/45 text-emerald-700 dark:border-emerald-400/45 dark:text-emerald-300',
  warning: 'border-amber-600/45 text-amber-700 dark:border-amber-400/45 dark:text-amber-300',
  danger: 'border-[var(--sf-danger)] text-[var(--sf-danger)]',
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

const typeStyles: Record<string, Tone> = {
  info: 'accent',
  warning: 'warning',
  important: 'danger',
  normal: 'neutral',
};

const typeLabels: Record<string, string> = {
  normal: '普通',
  info: '信息',
  warning: '警告',
  important: '重要',
};

function cx(...classes: (string | false | null | undefined)[]) {
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
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-[11px] tracking-[0.08em] text-[var(--sf-ink-3)]">共 {announcements.length} 条公告</p>
        <button type="button" onClick={openCreate} className={cx(BTN_BASE, BTN_PRIMARY, BTN_MD)}>+ 新建公告</button>
      </div>

      {loading ? (
        <div className="overflow-hidden rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)]" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse border-b border-[var(--sf-line-soft)] bg-[var(--sf-canvas)] last:border-b-0" />
          ))}
        </div>
      ) : announcements.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] px-3 py-10 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--sf-ink-3)]">EMPTY / 0</p>
          <p className="text-[13px] text-[var(--sf-ink-2)]">没有找到公告。</p>
        </div>
      ) : (
        <div className="min-w-0 overflow-x-auto rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)]">
          <table className="w-full min-w-[46rem] border-collapse text-[13px]">
            <caption className="sr-only">公告列表</caption>
            <thead>
              <tr className={TABLE_HEAD}>
                <th scope="col" className={TH}>标题</th>
                <th scope="col" className={TH}>类型</th>
                <th scope="col" className={TH}>生效区间</th>
                <th scope="col" className={TH}>状态</th>
                <th scope="col" className={cx(TH, 'text-right')}>操作</th>
              </tr>
            </thead>
            <tbody>
              {announcements.map((item) => (
                <tr key={item.id} className={TABLE_ROW}>
                  <td className={cx(TD, 'min-w-[14rem] max-w-[28rem]')}>
                    <p className="break-words font-medium text-[var(--sf-ink)] [overflow-wrap:anywhere]">{item.title}</p>
                    <p className="mt-0.5 line-clamp-2 break-words text-[12px] leading-snug text-[var(--sf-ink-2)] [overflow-wrap:anywhere]">{item.content}</p>
                  </td>
                  <td className={TD}>
                    <span
                      className={cx(
                        'inline-flex shrink-0 items-center gap-1 rounded-[2px] border px-1.5 py-0.5 font-mono text-[10px] leading-none tracking-[0.08em]',
                        TONE_CHIP[typeStyles[item.type] || 'neutral']
                      )}
                    >
                      {typeLabels[item.type] || '普通'}
                    </span>
                  </td>
                  <td className={cx(TD, 'whitespace-nowrap font-mono text-[11px] leading-relaxed text-[var(--sf-ink-3)]')}>
                    <span className="block">开始: {formatDate(item.start_at)}</span>
                    <span className="block">结束: {formatDate(item.end_at)}</span>
                  </td>
                  <td className={TD}>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleEnabled(item)}
                        role="switch"
                        aria-checked={!!item.enabled}
                        aria-label={item.enabled ? '禁用公告' : '启用公告'}
                        title={item.enabled ? '点击禁用' : '点击启用'}
                        className={cx(
                          'inline-flex h-5 w-9 shrink-0 items-center rounded-[2px] border px-[3px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)]',
                          item.enabled
                            ? 'justify-end border-[var(--sf-accent)] bg-[var(--sf-accent)]'
                            : 'justify-start border-[var(--sf-line-control)] bg-[var(--sf-canvas)]'
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cx(
                            'inline-block h-3 w-3 rounded-[1px] transition-colors',
                            item.enabled ? 'bg-[var(--sf-on-accent)]' : 'bg-[var(--sf-ink-3)]'
                          )}
                        />
                      </button>
                      <span className={cx('font-mono text-[10px] tracking-[0.06em]', item.enabled ? 'text-emerald-700 dark:text-emerald-300' : 'text-[var(--sf-ink-3)]')}>
                        {item.enabled ? '已启用' : '已禁用'}
                      </span>
                    </div>
                  </td>
                  <td className={cx(TD, 'text-right')}>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(item)}
                        className={cx(BTN_BASE, BTN_GHOST, BTN_ICON)}
                        title="编辑公告"
                        aria-label="编辑公告"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(item.id)}
                        className={cx(BTN_BASE, BTN_GHOST_DANGER, BTN_ICON)}
                        title="删除公告"
                        aria-label="删除公告"
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
              aria-labelledby="announcement-dialog-title"
              className="flex min-h-[var(--vvh,100dvh)] w-full max-w-md flex-col overflow-hidden rounded-none border border-[var(--sf-line)] bg-[var(--sf-surface)] p-5 sm:min-h-0 sm:rounded-[3px] sm:p-6"
            >
              <div className="mb-5 flex items-center gap-2 border-b border-[var(--sf-line)] pb-3">
                <span className="font-mono text-[10px] tracking-[0.2em] text-[var(--sf-ink-3)]">{editing.id ? 'EDIT' : 'NEW'}</span>
                <h2 id="announcement-dialog-title" className="break-words text-sm font-semibold tracking-tight text-[var(--sf-ink)] [overflow-wrap:anywhere]">
                  {editing.id ? '编辑公告' : '新建公告'}
                </h2>
                <span className="ml-1 h-px min-w-4 flex-1 bg-[var(--sf-line)]" aria-hidden="true" />
              </div>
              <div className="space-y-4">
                <div>
                  <label htmlFor="announcement-title" className={LABEL}>标题 <span className="text-[var(--sf-danger)]">*</span></label>
                  <input
                    id="announcement-title"
                    type="text"
                    value={editing.title || ''}
                    onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                    className={INPUT}
                    placeholder="公告标题"
                  />
                </div>
                <div>
                  <label htmlFor="announcement-content" className={LABEL}>内容 <span className="text-[var(--sf-danger)]">*</span></label>
                  <textarea
                    id="announcement-content"
                    value={editing.content || ''}
                    onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                    rows={4}
                    className={cx(INPUT, 'py-2 leading-relaxed')}
                    placeholder="公告内容"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="announcement-type" className={LABEL}>类型</label>
                    <select
                      id="announcement-type"
                      value={editing.type || 'normal'}
                      onChange={(e) => setEditing({ ...editing, type: e.target.value as Announcement['type'] })}
                      className={INPUT}
                    >
                      <option value="normal">普通</option>
                      <option value="info">信息</option>
                      <option value="warning">警告</option>
                      <option value="important">重要</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="announcement-enabled" className={LABEL}>状态</label>
                    <select
                      id="announcement-enabled"
                      value={editing.enabled ? 'true' : 'false'}
                      onChange={(e) => setEditing({ ...editing, enabled: e.target.value === 'true' })}
                      className={INPUT}
                    >
                      <option value="true">启用</option>
                      <option value="false">禁用</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="announcement-start" className={LABEL}>开始时间</label>
                    <input
                      id="announcement-start"
                      type="datetime-local"
                      value={editing.start_at || ''}
                      onChange={(e) => setEditing({ ...editing, start_at: e.target.value })}
                      className={INPUT}
                    />
                  </div>
                  <div>
                    <label htmlFor="announcement-end" className={LABEL}>结束时间</label>
                    <input
                      id="announcement-end"
                      type="datetime-local"
                      value={editing.end_at || ''}
                      onChange={(e) => setEditing({ ...editing, end_at: e.target.value })}
                      className={INPUT}
                    />
                  </div>
                </div>
              </div>
              <div className="mt-6 flex flex-col-reverse gap-2 border-t border-[var(--sf-line)] pt-4 sm:flex-row sm:justify-end">
                <button type="button" onClick={() => setEditing(null)} className={cx(BTN_BASE, BTN_SECONDARY, BTN_MD)}>取消</button>
                <button type="button" onClick={handleSave} disabled={saving} className={cx(BTN_BASE, BTN_PRIMARY, BTN_MD)}>{saving ? '保存中...' : '保存公告'}</button>
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
