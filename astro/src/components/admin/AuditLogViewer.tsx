import React, { useState, useMemo } from 'react';
import { motion, type Variants } from 'framer-motion';
import { useAuditLogs } from '../../hooks/domains/useAuditLogs';
import { showToast } from '../ui/Toast';
import { cn } from '../../lib/utils';
import type { AuditLog } from '../../lib/services/auditLogService';

const listVariants = {
  hidden: { opacity: 1 },
  visible: { transition: { staggerChildren: 0.03 } },
};
const itemVariants: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] } },
};

const actionTone: Record<string, string> = {
  create: 'border-success/30 bg-success/10 text-success',
  update: 'border-accent/30 bg-accent/10 text-accent',
  delete: 'border-danger/30 bg-danger/10 text-danger',
};

const collectionLabels: Record<string, string> = {
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

const actionLabels: Record<string, string> = {
  create: '创建',
  update: '更新',
  delete: '删除',
  admin_totp_registered: '注册身份验证器',
  admin_session_verified: '会话验证',
};

function parseAction(action: string): { verb: string; tone: string; label: string } {
  const parts = action.split('_');
  if (parts.length >= 2 && ['create', 'update', 'delete'].includes(parts[0])) {
    const verb = parts[0];
    return { verb, tone: actionTone[verb] || 'border-border bg-bg-soft text-text-secondary', label: actionLabels[verb] || verb };
  }
  return { verb: action, tone: 'border-warning/30 bg-warning/10 text-warning', label: actionLabels[action] || action };
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
    <div className="space-y-4">
      {/* 筛选器 */}
      <div className="card rounded-md p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="搜索目标 ID 或详情..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full rounded-md border border-border bg-bg-soft px-3 py-2 text-sm text-text outline-none focus:border-accent"
            />
          </div>
          <select
            value={filter.action || ''}
            onChange={(e) => updateFilter({ action: e.target.value || undefined })}
            className="rounded-md border border-border bg-bg-soft px-3 py-2 text-sm text-text outline-none focus:border-accent"
          >
            <option value="">全部操作</option>
            <option value="create">创建</option>
            <option value="update">更新</option>
            <option value="delete">删除</option>
          </select>
          <select
            value={filter.targetType || ''}
            onChange={(e) => updateFilter({ targetType: e.target.value || undefined })}
            className="rounded-md border border-border bg-bg-soft px-3 py-2 text-sm text-text outline-none focus:border-accent"
          >
            <option value="">全部类型</option>
            {Object.entries(collectionLabels).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          <button
            onClick={handleSearch}
            className="btn-primary min-h-10 px-4 text-xs"
          >
            搜索
          </button>
          <button
            onClick={() => {
              setSearchInput('');
              clearFilter();
            }}
            className="btn-ghost min-h-10 px-4 text-xs"
          >
            重置
          </button>
        </div>
      </div>

      {/* 统计 */}
      <div className="text-sm text-text-secondary">
        共 {totalItems} 条记录
      </div>

      {/* 日志列表 */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-md bg-bg-soft" />
          ))}
        </div>
      ) : logs.length === 0 ? (
        <div className="card rounded-md p-8 text-center text-text-secondary">
          暂无审计日志
        </div>
      ) : (
        <motion.div
          variants={listVariants}
          initial="hidden"
          animate="visible"
          className="space-y-2"
        >
          {parsedLogs.map((log) => (
            <motion.div
              key={log.id}
              variants={itemVariants}
              className="card rounded-md p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn('rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase', log.parsed.tone)}>
                      {log.parsed.label}
                    </span>
                    <span className="rounded-md border border-border bg-bg-soft px-2 py-0.5 font-mono text-[10px] uppercase text-text-secondary">
                      {collectionLabels[log.target_type] || log.target_type}
                    </span>
                    {log.target_id && (
                      <span className="font-mono text-xs text-muted">
                        #{log.target_id.slice(0, 8)}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-text-secondary">
                    <span>{log.expand?.actor?.name || log.actor_name || log.actor_email || '系统'}</span>
                    <span>{formatDate(log.created)}</span>
                    {log.ip_address && (
                      <span className="font-mono text-muted">{log.ip_address}</span>
                    )}
                  </div>
                  {log.details && Object.keys(log.details).length > 0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-accent hover:underline">
                        查看详情
                      </summary>
                      <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-bg-soft p-2 font-mono text-[10px] text-text-secondary">
                        {JSON.stringify(log.details, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage(page - 1)}
            disabled={page <= 1}
            className="btn-ghost min-h-10 px-4 text-xs disabled:opacity-50"
          >
            上一页
          </button>
          <span className="text-sm text-text-secondary">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage(page + 1)}
            disabled={page >= totalPages}
            className="btn-ghost min-h-10 px-4 text-xs disabled:opacity-50"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}