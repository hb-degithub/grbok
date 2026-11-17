import React, { useState, useMemo } from 'react';
import { motion, type Variants } from 'framer-motion';
import { useAuditLogs } from '../../hooks/domains/useAuditLogs';
import { showToast } from '../ui/Toast';
import { cn } from '../../lib/utils';
import type { AuditLog } from '../../lib/services/auditLogService';

/*
 * 审计日志（后台）
 * - 只用 --sf-* 令牌：surface/canvas + 细线 + 三档墨色 + 单一强调色，圆角统一 3px；
 * - 表格：表头等宽小字 + 底部 1px 细线；行 hover 只改底色；
 * - 动作徽标细线 chip：创建 emerald、更新强调色、删除 --sf-danger、其它 amber；
 * - 筛选/搜索/重置/分页与 details 展开逻辑与改造前完全一致。
 */

const listVariants = {
  hidden: { opacity: 1 },
  visible: { transition: { staggerChildren: 0.03 } },
};
const itemVariants: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] } },
};

/* 语义色只保留四种：成功 emerald、强调 accent、危险 --sf-danger、中性 ink-3 / 警告 amber。 */
const actionTone: Record<string, string> = {
  create: 'border-emerald-600/45 text-emerald-700 dark:border-emerald-400/45 dark:text-emerald-300',
  update: 'border-[var(--sf-accent)] text-[var(--sf-accent-ink)]',
  delete: 'border-[var(--sf-danger)] text-[var(--sf-danger)]',
};

const COLLECTION_LABELS: Record<string, string> = {
  posts: '文章',
  comments: '评论',
  tags: '标签',
  users: '用户',
  friend_links: '友链',
  announcements: '公告',
  media_assets: '媒体',
  admin_totp_bindings: '身份验证器',
  admin_verified_sessions: '会话',
};

const ACTION_LABELS: Record<string, string> = {
  create: '创建',
  update: '更新',
  delete: '删除',
  admin_totp_registered: '注册身份验证器',
  admin_session_verified: '会话验证',
};

const BTN_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-[3px] border font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)] disabled:cursor-not-allowed disabled:opacity-50';
const BTN_PRIMARY =
  'border-[var(--sf-accent)] bg-[var(--sf-accent)] text-[var(--sf-on-accent)] hover:border-[var(--sf-accent-ink)] hover:bg-[var(--sf-accent-ink)]';
const BTN_SECONDARY =
  'border-[var(--sf-line-control)] bg-[var(--sf-surface)] text-[var(--sf-ink)] hover:border-[var(--sf-accent)] hover:text-[var(--sf-accent-ink)]';
const BTN_SM = 'min-h-10 px-3 text-[12px]';

const FIELD_CLS =
  'min-h-[40px] min-w-0 rounded-[3px] border border-[var(--sf-line-control)] bg-[var(--sf-surface)] px-3 text-sm text-[var(--sf-ink)] placeholder:text-[var(--sf-ink-3)] outline-none transition-colors focus-visible:border-[var(--sf-accent)] focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)]';

const CHIP_BASE =
  'inline-flex items-center gap-1 rounded-[2px] border px-1.5 py-0.5 font-mono text-[10px] leading-none tracking-[0.08em]';
const CHIP_NEUTRAL = 'border-[var(--sf-line)] text-[var(--sf-ink-3)]';

const TABLE_HEAD =
  'border-b border-[var(--sf-line)] bg-[var(--sf-canvas)] text-left font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--sf-ink-3)]';
const TABLE_ROW = 'border-b border-[var(--sf-line-soft)] transition-colors last:border-b-0 hover:bg-[var(--sf-canvas)]';
const TH = 'whitespace-nowrap px-3 py-2 font-medium';
const TD = 'px-3 py-2.5 align-top';

function parseAction(action: string): { verb: string; tone: string; label: string } {
  const parts = action.split('_');
  if (parts.length >= 2 && ['create', 'update', 'delete'].includes(parts[0])) {
    const verb = parts[0];
    return { verb, tone: actionTone[verb] || CHIP_NEUTRAL, label: ACTION_LABELS[verb] || verb };
  }
  return { verb: action, tone: 'border-amber-600/45 text-amber-700 dark:border-amber-400/45 dark:text-amber-300', label: ACTION_LABELS[action] || action };
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AuditLogViewer() {
  const {
    logs,
    loading,
    page,
    totalPages,
    totalItems,
    filter,
    setPage,
    updateFilter,
    clearFilter,
  } = useAuditLogs();

  const [searchInput, setSearchInput] = useState('');

  const handleSearch = () => {
    updateFilter({ query: searchInput || undefined });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const parsedLogs = useMemo(() => {
    return logs.map(log => ({
      ...log,
      parsed: parseAction(log.action),
    }));
  }, [logs]);

  return (
    <div className="min-w-0 space-y-3">
      {/* 筛选器 */}
      <div className="rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1 basis-full sm:basis-[220px]">
            <input
              type="text"
              placeholder="搜索目标 ID 或详情..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={handleKeyDown}
              aria-label="搜索审计日志"
              className={`${FIELD_CLS} w-full`}
            />
          </div>
          <select
            value={filter.action || ''}
            onChange={(e) => updateFilter({ action: e.target.value || undefined })}
            aria-label="按操作筛选"
            className={`${FIELD_CLS} w-full sm:w-auto`}
          >
            <option value="">全部操作</option>
            <option value="create">创建</option>
            <option value="update">更新</option>
            <option value="delete">删除</option>
          </select>
          <select
            value={filter.targetType || ''}
            onChange={(e) => updateFilter({ targetType: e.target.value || undefined })}
            aria-label="按对象类型筛选"
            className={`${FIELD_CLS} w-full sm:w-auto`}
          >
            <option value="">全部类型</option>
            {Object.entries(COLLECTION_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          <button
            onClick={handleSearch}
            className={`${BTN_BASE} ${BTN_PRIMARY} ${BTN_SM}`}
          >
            搜索
          </button>
          <button
            onClick={() => {
              setSearchInput('');
              clearFilter();
            }}
            className={`${BTN_BASE} ${BTN_SECONDARY} ${BTN_SM}`}
          >
            重置
          </button>
        </div>
      </div>

      {/* 日志表格 */}
      <div className="min-w-0 overflow-hidden rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)]">
        <div className="flex items-center justify-between gap-2 border-b border-[var(--sf-line)] bg-[var(--sf-canvas)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--sf-ink-3)]">
          <span>Audit / 操作记录</span>
          <span className="tabular-nums">共 {totalItems} 条记录</span>
        </div>

        {loading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-[3px] border border-[var(--sf-line-soft)] bg-[var(--sf-canvas)]" />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 px-3 py-10 text-center">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--sf-ink-3)]">EMPTY / 0</p>
            <p className="text-[13px] text-[var(--sf-ink-2)]">暂无审计日志</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] border-collapse text-[13px]">
              <caption className="sr-only">审计日志列表</caption>
              <thead>
                <tr className={TABLE_HEAD}>
                  <th scope="col" className={TH}>操作</th>
                  <th scope="col" className={TH}>对象</th>
                  <th scope="col" className={TH}>目标</th>
                  <th scope="col" className={TH}>操作者</th>
                  <th scope="col" className={TH}>时间</th>
                  <th scope="col" className={TH}>IP</th>
                  <th scope="col" className={TH}>详情</th>
                </tr>
              </thead>
              <motion.tbody variants={listVariants} initial="hidden" animate="visible">
                {parsedLogs.map((log) => (
                  <motion.tr key={log.id} variants={itemVariants} className={TABLE_ROW}>
                    <td className={TD}>
                      <span className={cn(CHIP_BASE, log.parsed.tone)}>
                        {log.parsed.label}
                      </span>
                    </td>
                    <td className={TD}>
                      <span className={cn(CHIP_BASE, CHIP_NEUTRAL)}>
                        {COLLECTION_LABELS[log.target_type] || log.target_type}
                      </span>
                    </td>
                    <td className={cn(TD, 'whitespace-nowrap')}>
                      {log.target_id && (
                        <span className="font-mono text-[11px] tracking-[0.06em] text-[var(--sf-ink-3)]">
                          #{log.target_id.slice(0, 8)}
                        </span>
                      )}
                    </td>
                    <td className={cn(TD, 'whitespace-nowrap text-[var(--sf-ink)]')}>
                      <span className="break-words [overflow-wrap:anywhere]">{log.expand?.actor?.name || log.actor_name || log.actor_email || '系统'}</span>
                    </td>
                    <td className={cn(TD, 'whitespace-nowrap font-mono text-[11px] tabular-nums text-[var(--sf-ink-3)]')}>
                      {formatDate(log.created)}
                    </td>
                    <td className={cn(TD, 'whitespace-nowrap')}>
                      {log.ip_address && (
                        <span className="font-mono text-[11px] tracking-[0.06em] text-[var(--sf-ink-3)]">{log.ip_address}</span>
                      )}
                    </td>
                    <td className={cn(TD, 'min-w-[10rem]')}>
                      {log.details && Object.keys(log.details).length > 0 && (
                        <details>
                          <summary className="cursor-pointer whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--sf-accent-ink)] hover:underline">
                            查看详情
                          </summary>
                          <pre className="mt-2 max-h-40 max-w-[28rem] overflow-auto rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-canvas)] p-2 font-mono text-[10px] leading-relaxed text-[var(--sf-ink-2)]">
                            {JSON.stringify(log.details, null, 2)}
                          </pre>
                        </details>
                      )}
                    </td>
                  </motion.tr>
                ))}
              </motion.tbody>
            </table>
          </div>
        )}
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <nav className="flex flex-wrap items-center gap-2" aria-label="审计日志分页">
          <span className="mr-auto font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--sf-ink-3)]">
            PAGE / {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage(page - 1)}
            disabled={page <= 1}
            className={`${BTN_BASE} ${BTN_SECONDARY} ${BTN_SM}`}
          >
            上一页
          </button>
          <button
            onClick={() => setPage(page + 1)}
            disabled={page >= totalPages}
            className={`${BTN_BASE} ${BTN_SECONDARY} ${BTN_SM}`}
          >
            下一页
          </button>
        </nav>
      )}
    </div>
  );
}
