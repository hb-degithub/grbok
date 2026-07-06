import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { getPocketBase } from '../../lib/pocketbase';
import { showToast } from '../ui/Toast';
import { cn } from '../../lib/utils';
import type { AuditLog } from '../../types/pocketbase';

const listVariants = {
  hidden: { opacity: 1 },
  visible: { transition: { staggerChildren: 0.03 } },
};
const itemVariants = {
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
  admin_passkeys: '密钥',
  admin_verified_sessions: '会话',
};

const actionLabels: Record<string, string> = {
  create: '创建',
  update: '更新',
  delete: '删除',
  admin_passkey_registered: '注册密钥',
  admin_session_verified: '会话验证',
};

function parseAction(action: string): { verb: string; tone: string; label: string } {
  // action is either "create_posts" / "update_users" / "delete_tags" or a standalone like "admin_passkey_registered"
  const parts = action.split('_');
  if (parts.length >= 2 && ['create', 'update', 'delete'].includes(parts[0])) {
    const verb = parts[0];
    return { verb, tone: actionTone[verb] || 'border-border bg-bg-soft text-text-secondary', label: actionLabels[verb] || verb };
  }
  return { verb: action, tone: 'border-warning/30 bg-warning/10 text-warning', label: actionLabels[action] || action };
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}

export default function AuditLogViewer() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [filterVerb, setFilterVerb] = useState<string>('all');
  const [filterCollection, setFilterCollection] = useState<string>('all');

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError('');
    const pb = getPocketBase();
    try {
      const filters: string[] = [];
      if (filterVerb !== 'all') filters.push(pb.filter('action ~ {:verb}', { verb: filterVerb }));
      if (filterCollection !== 'all') filters.push(pb.filter('target_collection = {:col}', { col: filterCollection }));
      const filter = filters.join(' && ');
      const result = await pb.collection('audit_logs').getList<AuditLog>(page, 30, { filter, sort: '-created' });
      setLogs(result.items);
      setTotalPages(result.totalPages);
    } catch (err) {
      console.error('获取审计日志失败:', err);
      setError('加载失败，请确认当前账号为超级管理员。');
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [page, filterVerb, filterCollection]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);
  useEffect(() => { setPage(1); }, [filterVerb, filterCollection]);

  const pageLabel = `第 ${page}/${Math.max(totalPages, 1)} 页 · ${logs.length} 条`;

  const collectionOptions = useMemo(() => Object.keys(collectionLabels), []);

  return (
    <div className="min-w-0 space-y-4">
      <div className="card flex flex-wrap items-center gap-2 rounded-md p-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-1">
          {['all', 'create', 'update', 'delete'].map((v) => (
            <button key={v} onClick={() => setFilterVerb(v)} className={cn('min-h-9 rounded-md border px-3 py-1.5 text-xs transition-all', filterVerb === v ? 'border-accent/30 bg-accent/10 text-accent' : 'border-transparent text-text-secondary hover:border-border hover:bg-bg-soft hover:text-text')}>
              {v === 'all' ? '全部操作' : actionLabels[v] || v}
            </button>
          ))}
        </div>
        <select value={filterCollection} onChange={(e) => setFilterCollection(e.target.value)} className="min-h-9 rounded-md border border-border bg-bg-soft px-2 py-1.5 text-xs text-text outline-none focus:border-accent">
          <option value="all">全部类型</option>
          {collectionOptions.map((c) => <option key={c} value={c}>{collectionLabels[c]}</option>)}
        </select>
        <div className="hidden flex-1 sm:block" />
        <span className="font-mono text-[10px] text-muted">{pageLabel}</span>
      </div>

      {error && (
        <div className="rounded-md border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger [overflow-wrap:anywhere]" role="alert">{error}</div>
      )}

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-md border border-border bg-bg-soft" />)}</div>
      ) : logs.length === 0 ? (
        <div className="card rounded-md p-12 text-center text-sm text-text-secondary">没有匹配的审计记录。</div>
      ) : (
        <motion.div variants={listVariants} initial="hidden" animate="visible" className="space-y-2">
          {logs.map((log) => {
            const { tone, label } = parseAction(log.action);
            const colLabel = collectionLabels[log.target_collection] || log.target_collection || '—';
            return (
              <motion.div key={log.id} variants={itemVariants} className="card flex flex-col gap-2 rounded-md border border-border bg-white p-3 shadow-xs sm:flex-row sm:items-center sm:gap-3 sm:p-3.5">
                <span className={cn('shrink-0 rounded border px-2 py-0.5 font-mono text-[10px] uppercase', tone)}>{label}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded border border-border bg-bg-soft px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">{colLabel}</span>
                    <p className="break-words text-xs text-text [overflow-wrap:anywhere]">{log.summary || '—'}</p>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] text-muted">
                    <span>操作者 <span className="text-text-secondary">{log.actor === 'anonymous' ? '匿名' : log.actor.slice(0, 8)}</span></span>
                    {log.target_id && <span className="truncate">目标 {log.target_id.slice(0, 12)}</span>}
                    <span>IP {log.ip}</span>
                  </div>
                </div>
                <span className="shrink-0 font-mono text-[10px] text-muted">{formatTime(log.created)}</span>
              </motion.div>
            );
          })}
        </motion.div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="inline-flex h-10 min-w-10 items-center justify-center rounded-md border border-border bg-white px-3 text-sm text-text-secondary transition-colors hover:border-border-hover disabled:cursor-not-allowed disabled:opacity-40">上一页</button>
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
            .map((p, idx, arr) => (
              <React.Fragment key={p}>
                {idx > 0 && arr[idx - 1] !== p - 1 && <span className="px-1 text-muted">…</span>}
                <button onClick={() => setPage(p)} aria-current={page === p ? 'page' : undefined} className={cn('inline-flex h-10 min-w-10 items-center justify-center rounded-md border px-3 text-sm font-medium transition-all', page === p ? 'border-accent/30 bg-accent/10 text-accent' : 'border-border bg-white text-text-secondary hover:border-border-hover hover:text-text')}>{p}</button>
              </React.Fragment>
            ))}
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="inline-flex h-10 min-w-10 items-center justify-center rounded-md border border-border bg-white px-3 text-sm text-text-secondary transition-colors hover:border-border-hover disabled:cursor-not-allowed disabled:opacity-40">下一页</button>
        </div>
      )}
    </div>
  );
}
