import React, { useState } from 'react';
import { motion, type Variants } from 'framer-motion';
import { useAdminUsers } from '../../hooks/domains/useAdminUsers';
import { useAdminAuth, type AdminRole } from '../../hooks/useAdminAuth';
import ConfirmDialog from '../ui/ConfirmDialog';
import type { AdminUser } from '../../lib/services/adminUserService';

/* 用户管理（科幻简约 · 批次 C5）
   只使用 --sf-* 令牌：surface/canvas + 四档细线 + 三档墨色 + 唯一强调色，圆角统一 3px（徽标 2px）。
   状态徽标为细线 chip：已验证 emerald、未验证 amber、角色按危险/警告/强调/中性分档。
   搜索、角色下拉、删除确认、超级管理员保护与权限判断全部与改造前一致。 */

const listVariants: Variants = {
  hidden: { opacity: 1 },
  visible: { transition: { staggerChildren: 0.04 } }
};
const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] } }
};

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const CHIP =
  'inline-flex shrink-0 items-center rounded-[2px] border px-1.5 py-0.5 font-mono text-[10px] leading-none tracking-[0.08em]';
/** 角色徽标略大一号，单独定义避免与 CHIP 的 padding 类互相覆盖。 */
const ROLE_CHIP =
  'inline-flex shrink-0 items-center rounded-[2px] border px-2.5 py-1 font-mono text-[10px] leading-none tracking-[0.08em]';
const TONE_CHIP: Record<Tone, string> = {
  neutral: 'border-[var(--sf-line)] text-[var(--sf-ink-3)]',
  accent: 'border-[var(--sf-accent)] text-[var(--sf-accent)]',
  success: 'border-emerald-600/45 text-emerald-700 dark:border-emerald-400/45 dark:text-emerald-300',
  warning: 'border-amber-600/45 text-amber-700 dark:border-amber-400/45 dark:text-amber-300',
  danger: 'border-[var(--sf-danger)] text-[var(--sf-danger)]',
};

const roleTone: Record<string, Tone> = {
  super_admin: 'danger',
  admin: 'warning',
  author: 'accent',
  reader: 'neutral',
};

const roleLabels: Record<string, string> = {
  super_admin: '超级管理员',
  admin: '管理员',
  author: '作者',
  reader: '普通用户',
};

/* 搜索框与 ui/Input.tsx 同一套：surface 底 + 控制线描边 + 强调色焦点环。 */
const SEARCH_INPUT =
  'h-10 w-full rounded-[3px] border border-[var(--sf-line-control)] bg-[var(--sf-surface)] pl-9 pr-3 text-[16px] text-[var(--sf-ink)] outline-none transition-colors placeholder:text-[var(--sf-ink-3)] focus-visible:border-[var(--sf-accent)] focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)] sm:text-sm';
const ROLE_SELECT =
  'min-h-10 min-w-0 flex-1 rounded-[3px] border border-[var(--sf-line-control)] bg-[var(--sf-surface)] px-2 py-1 text-xs text-[var(--sf-ink)] outline-none transition-colors hover:border-[var(--sf-line-strong)] focus-visible:border-[var(--sf-accent)] focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)] disabled:cursor-not-allowed disabled:opacity-60 min-[390px]:flex-none';
const COUNT = 'font-mono text-[11px] tracking-[0.08em] text-[var(--sf-ink-3)]';

export default function UserManager() {
  const [query, setQuery] = useState('');
  const [confirmState, setConfirmState] = useState<{ open: boolean; title: string; message: string; onConfirm: () => void }>({ open: false, title: '', message: '', onConfirm: () => {} });
  const { user: currentUser } = useAdminAuth();
  const { users, loading, error, updatingId, deletingId, updateRole, deleteUser, getAvatarUrl, setError } = useAdminUsers();
  const superAdminCount = users.filter((user) => user.role === 'super_admin').length;

  const handleUpdateRole = (targetUser: AdminUser, role: AdminRole) => {
    if (targetUser.role === role) return;
    if (targetUser.role === 'super_admin' && role !== 'super_admin' && superAdminCount <= 1) {
      setError('至少需要保留一个超级管理员。');
      return;
    }
    const label = roleLabels[role] || role;
    setConfirmState({ open: true, title: '确认操作', message: `确定把 ${targetUser.name || targetUser.email} 的角色改为 ${label} 吗？`, onConfirm: async () => {
      await updateRole(targetUser, role, superAdminCount);
    }});
  };

  const handleDeleteUser = (targetUser: AdminUser) => {
    if (targetUser.role === 'super_admin' && superAdminCount <= 1) {
      setError('至少需要保留一个超级管理员，无法删除。');
      return;
    }
    if (targetUser.id === currentUser?.id) {
      setError('不能删除当前登录的账号。');
      return;
    }
    setConfirmState({ open: true, title: '确认删除用户', message: `确定删除用户 ${targetUser.name || targetUser.email} 吗？此操作无法撤销，该用户的评论记录会保留。`, onConfirm: async () => {
      await deleteUser(targetUser, superAdminCount, currentUser?.id);
    }});
  };

  if (loading) {
    return (
      <div className="space-y-2" aria-hidden="true">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-[3px] border border-[var(--sf-line-soft)] bg-[var(--sf-canvas)]" />
        ))}
      </div>
    );
  }

  const filteredUsers = (() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return users;
    return users.filter((u) => [u.name, u.email].some((v) => String(v || '').toLowerCase().includes(keyword)));
  })();

  if (users.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1.5 rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] px-3 py-10 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--sf-ink-3)]">EMPTY / 0</p>
        <p className="text-sm text-[var(--sf-ink-2)] [overflow-wrap:anywhere]">没有找到用户。</p>
      </div>
    );
  }

  if (filteredUsers.length === 0) {
    return (
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={COUNT}>共 0 / {users.length} 个用户</p>
          <label className="relative block w-full sm:w-72">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center" aria-hidden="true">
              <svg className="h-4 w-4 text-[var(--sf-ink-3)]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 21l-4.35-4.35M11 18a7 7 0 110-14 7 7 0 010 14z" /></svg>
            </span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索姓名或邮箱" className={SEARCH_INPUT} />
          </label>
        </div>
        <div className="flex flex-col items-center gap-1.5 rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] px-3 py-10 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--sf-ink-3)]">MATCH / 0</p>
          <p className="text-sm text-[var(--sf-ink-2)]">没有匹配的用户。</p>
        </div>
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

  return (
    <div className="min-w-0 space-y-3 sm:overflow-hidden sm:rounded-[3px] sm:border sm:border-[var(--sf-line)] sm:bg-[var(--sf-surface)]">
      {error && (
        <div className="border-b border-[var(--sf-danger)] px-4 py-3 text-sm text-[var(--sf-danger)] [overflow-wrap:anywhere]" role="alert">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={COUNT}>共 {filteredUsers.length}{query ? ` / ${users.length}` : ''} 个用户</p>
        <label className="relative block w-full sm:w-72">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center" aria-hidden="true">
            <svg className="h-4 w-4 text-[var(--sf-ink-3)]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 21l-4.35-4.35M11 18a7 7 0 110-14 7 7 0 010 14z" /></svg>
          </span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索姓名或邮箱" className={SEARCH_INPUT} />
        </label>
      </div>

      <div className="hidden grid-cols-[minmax(0,1fr)_minmax(9rem,auto)_auto] gap-4 border-b border-[var(--sf-line)] bg-[var(--sf-canvas)] px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--sf-ink-3)] sm:grid">
        <span>用户</span>
        <span>角色分配</span>
        <span className="hidden w-24 text-right sm:block">加入时间</span>
      </div>

      <motion.div variants={listVariants} initial="hidden" animate="visible" className="space-y-3 sm:space-y-0">
        {filteredUsers.map((user) => {
          const isLastSuperAdmin = user.role === 'super_admin' && superAdminCount <= 1;
          const isUpdating = updatingId === user.id;
          const isDeleting = deletingId === user.id;
          const canModify = currentUser?.role === 'super_admin' && user.id !== currentUser?.id;

          return (
            <motion.div
              key={user.id}
              variants={itemVariants}
              className="grid grid-cols-[minmax(0,1fr)] items-center gap-3 rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-3 transition-colors hover:bg-[var(--sf-canvas)] sm:grid-cols-[minmax(0,1fr)_minmax(9rem,auto)_6rem] sm:rounded-none sm:border-x-0 sm:border-t-0 sm:border-b sm:border-[var(--sf-line-soft)] sm:bg-transparent sm:px-4 sm:py-3 sm:hover:bg-[var(--sf-canvas)] sm:last:border-b-0"
            >
              <div className="flex min-w-0 items-center gap-3">
                {user.avatar ? (
                  <img
                    src={getAvatarUrl(user)}
                    alt=""
                    className="h-9 w-9 shrink-0 rounded-[2px] object-cover"
                    onError={(event) => { (event.target as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : (
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[2px] bg-[var(--sf-accent)] text-xs font-semibold text-[var(--sf-on-accent)]">
                    {user.name?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="break-words text-sm font-semibold text-[var(--sf-ink)] [overflow-wrap:anywhere]">{user.name || '未命名用户'}</p>
                    {user.verified ? (
                      <span className={CHIP + ' ' + TONE_CHIP.success} title="邮箱已验证">已验证</span>
                    ) : (
                      <span className={CHIP + ' ' + TONE_CHIP.warning} title="邮箱未验证">未验证</span>
                    )}
                  </div>
                  <p className="break-all font-mono text-[10px] text-[var(--sf-ink-3)] [overflow-wrap:anywhere]">{user.email || '无邮箱'}</p>
                </div>
              </div>

              <div className="flex min-w-0 flex-wrap items-stretch gap-2 min-[390px]:items-center">
                <span className={ROLE_CHIP + ' ' + (TONE_CHIP[roleTone[user.role]] || TONE_CHIP.neutral)}>
                  {roleLabels[user.role] || user.role}
                </span>
                <select
                  value={user.role}
                  onChange={(event) => handleUpdateRole(user, event.target.value as AdminRole)}
                  disabled={isUpdating || isLastSuperAdmin || currentUser?.role !== 'super_admin'}
                  title={isLastSuperAdmin ? '不能降级最后一个超级管理员' : '修改用户角色'}
                  className={ROLE_SELECT}
                >
                  <option value="reader">普通用户</option>
                  <option value="author">作者</option>
                  <option value="admin">管理员</option>
                  <option value="super_admin">超级管理员</option>
                </select>
                <button
                  onClick={() => handleDeleteUser(user)}
                  disabled={!canModify || isDeleting || isLastSuperAdmin}
                  title={isLastSuperAdmin ? '不能删除最后一个超级管理员' : !canModify ? '无权限' : '删除用户'}
                  aria-label="删除用户"
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[3px] text-[var(--sf-ink-2)] transition-colors hover:bg-[var(--sf-line-soft)] hover:text-[var(--sf-danger)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isDeleting ? (
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  ) : (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  )}
                </button>
              </div>

              <span className="hidden text-right font-mono text-[11px] text-[var(--sf-ink-3)] sm:block">{new Date(user.created).toLocaleDateString('zh-CN')}</span>
            </motion.div>
          );
        })}
      </motion.div>
      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        message={confirmState.message}
        onConfirm={() => { confirmState.onConfirm(); setConfirmState(s => ({ ...s, open: false })); }}
        onCancel={() => setConfirmState(s => ({ ...s, open: false }))}
      />
    </div>
  );
}
