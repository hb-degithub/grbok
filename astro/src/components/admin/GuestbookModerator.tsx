import React from 'react';
import { motion } from 'framer-motion';
import { useGuestbookAdmin } from '../../hooks/domains/useGuestbookAdmin';
import type { GuestbookItem } from '../../lib/services/guestbookService';

/* ===========================
   留言治理（后台）
   - 只用 --sf-* 令牌：surface/canvas + 四档细线 + 三档墨色 + 单一强调色；
   - 圆角统一 3px（徽标 2px），列表靠 1px 细线分隔，行 hover 只改底色；
   - 状态色只用于语义：显示中 emerald、已隐藏 ink-3、删除 --sf-danger。
   列表、筛选、上下架与删除确认（window.confirm）逻辑与改造前一致。
   =========================== */

type Tone = 'neutral' | 'success';

const TONE_CHIP: Record<Tone, string> = {
  neutral: 'border-[var(--sf-line)] text-[var(--sf-ink-3)]',
  success: 'border-emerald-600/45 text-emerald-700 dark:border-emerald-400/45 dark:text-emerald-300',
};

const BTN_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-[3px] border font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)] disabled:cursor-not-allowed disabled:opacity-50';
const BTN_SECONDARY =
  'border-[var(--sf-line-control)] bg-[var(--sf-surface)] text-[var(--sf-ink)] hover:border-[var(--sf-accent)] hover:text-[var(--sf-accent-ink)]';
const BTN_DANGER =
  'border-[var(--sf-danger)] bg-[var(--sf-surface)] text-[var(--sf-danger)] hover:bg-[var(--sf-danger)] hover:text-[var(--sf-on-accent)]';
const BTN_SM = 'min-h-8 px-2.5 text-[12px]';

const FILTER_ON = 'border-[var(--sf-accent)] bg-[var(--sf-accent)] text-[var(--sf-on-accent)]';
const FILTER_OFF =
  'border-[var(--sf-line)] bg-[var(--sf-surface)] text-[var(--sf-ink-2)] hover:border-[var(--sf-line-strong)] hover:text-[var(--sf-ink)]';

const TABLE_HEAD =
  'border-b border-[var(--sf-line)] bg-[var(--sf-canvas)] text-left font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--sf-ink-3)]';
const TABLE_ROW = 'border-b border-[var(--sf-line-soft)] transition-colors last:border-b-0 hover:bg-[var(--sf-canvas)]';
const TH = 'whitespace-nowrap px-3 py-2 font-medium';
const TD = 'px-3 py-2.5 align-top';

function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

export default function GuestbookModerator() {
  const {
    items,
    loading,
    error,
    status,
    filter,
    setFilter,
    toggleStatus: toggleStatusService,
    remove: removeService,
  } = useGuestbookAdmin();

  const toggleStatus = async (item: GuestbookItem) => {
    await toggleStatusService(item);
  };

  const remove = async (item: GuestbookItem) => {
    if (!window.confirm(`确定删除「${item.nickname}」的留言？此操作不可逆。`)) return;
    await removeService(item);
  };

  const fmtDate = (s: string) => {
    if (!s) return '-';
    try { return new Date(s.replace(' ', 'T')).toLocaleString('zh-CN'); } catch { return s; }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-w-0 space-y-4">
      <header className="min-w-0">
        <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--sf-ink-3)]">
          <span className="h-1 w-1 bg-[var(--sf-accent)]" aria-hidden="true" />
          Guestbook / Moderate
        </p>
        <h1 className="mt-1.5 break-words text-xl font-bold leading-tight tracking-tight text-[var(--sf-ink)]">留言治理</h1>
        <p className="mt-1.5 text-[13px] text-[var(--sf-ink-2)]">管理公开留言板的显示与删除</p>
      </header>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="留言状态筛选">
        {['', 'show', 'hidden'].map((s) => (
          <button
            key={s || 'all'}
            type="button"
            onClick={() => setFilter(s)}
            aria-pressed={filter === s}
            className={cx(
              'min-h-8 rounded-[3px] border px-2.5 font-mono text-[11px] tracking-[0.06em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)]',
              filter === s ? FILTER_ON : FILTER_OFF
            )}
          >
            {s === 'show' ? '显示中' : s === 'hidden' ? '已隐藏' : '全部'}
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" className="break-words rounded-[3px] border border-[var(--sf-danger)] bg-[var(--sf-surface)] px-3 py-2 text-[13px] text-[var(--sf-danger)] [overflow-wrap:anywhere]">
          {error}
        </div>
      )}
      {status && (
        <div className="break-words rounded-[3px] border border-emerald-600/45 bg-[var(--sf-surface)] px-3 py-2 text-[13px] text-emerald-700 dark:border-emerald-400/45 dark:text-emerald-300 [overflow-wrap:anywhere]">
          {status}
        </div>
      )}
      {loading && (
        <p className="flex items-center gap-2 font-mono text-[11px] tracking-[0.18em] text-[var(--sf-ink-3)]">
          <span className="h-1 w-1 animate-pulse bg-[var(--sf-accent)]" aria-hidden="true" />
          加载中…
        </p>
      )}

      {!loading && items.length === 0 && (
        <div className="flex flex-col items-center gap-1.5 rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] px-3 py-10 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--sf-ink-3)]">EMPTY / 0</p>
          <p className="text-[13px] text-[var(--sf-ink-2)]">暂无留言记录</p>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="min-w-0 overflow-x-auto rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)]">
          <table className="w-full min-w-[46rem] border-collapse text-[13px]">
            <caption className="sr-only">留言列表</caption>
            <thead>
              <tr className={TABLE_HEAD}>
                <th scope="col" className={TH}>昵称</th>
                <th scope="col" className={TH}>内容</th>
                <th scope="col" className={TH}>状态</th>
                <th scope="col" className={TH}>时间</th>
                <th scope="col" className={cx(TH, 'text-right')}>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className={TABLE_ROW}>
                  <td className={cx(TD, 'whitespace-nowrap font-medium text-[var(--sf-ink)]')}>{item.nickname}</td>
                  <td className={cx(TD, 'min-w-[16rem] max-w-[32rem] whitespace-normal')}>
                    <p className="break-words leading-relaxed text-[var(--sf-ink-2)] [overflow-wrap:anywhere]">{item.content}</p>
                  </td>
                  <td className={TD}>
                    <span
                      className={cx(
                        'inline-flex items-center gap-1 rounded-[2px] border px-1.5 py-0.5 font-mono text-[10px] leading-none tracking-[0.08em]',
                        item.status === 'show' ? TONE_CHIP.success : TONE_CHIP.neutral
                      )}
                    >
                      {item.status === 'show' ? '显示' : '隐藏'}
                    </span>
                  </td>
                  <td className={cx(TD, 'whitespace-nowrap font-mono text-[11px] text-[var(--sf-ink-3)]')}>{fmtDate(item.created)}</td>
                  <td className={cx(TD, 'text-right')}>
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => toggleStatus(item)}
                        className={cx(BTN_BASE, BTN_SECONDARY, BTN_SM)}
                        title={item.status === 'show' ? '隐藏留言' : '显示留言'}
                        aria-label={item.status === 'show' ? '隐藏留言' : '显示留言'}
                      >
                        {item.status === 'show' ? '隐藏' : '显示'}
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(item)}
                        className={cx(BTN_BASE, BTN_DANGER, BTN_SM)}
                        title="删除留言"
                        aria-label="删除留言"
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </motion.div>
  );
}
