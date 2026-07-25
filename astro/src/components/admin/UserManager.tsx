import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { getPocketBase } from '../../lib/pocketbase';
import { useAdminAuth, type AdminRole } from '../../hooks/useAdminAuth';
import { showToast } from '../ui/Toast';
import ConfirmDialog from '../ui/ConfirmDialog';
import type { User } from '../../types/pocketbase';

const listVariants = {
  hidden: { opacity: 1 },
  visible: { transition: { staggerChildren: 0.04 } }
};
const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] } }
};

const roleColors: Record<string, string> = {
  super_admin: 'bg-danger/10 text-danger border-danger/25',
  admin: 'bg-warning/10 text-warning border-warning/25',
  author: 'bg-accent/10 text-accent border-accent/25',
  reader: 'bg-text-muted/10 text-text-secondary border-text-muted/30',
};

const roleLabels: Record<string, string> = {
  super_admin: '超级管理员',
  admin: '管理员',
  author: '作者',
  reader: '普通用户',
};

export default function UserManager() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [updatingId, setUpdatingId] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [error, setError] = useState('');
  const [confirmState, setConfirmState] = useState<{ open: boolean; title: string; message: string; onConfirm: () => void }>({ open: false, title: '', message: '', onConfirm: () => {} });
  const { user: currentUser } = useAdminAuth();
  const superAdminCount = users.filter((user) => user.role === 'super_admin').length;

  useEffect(() => {
    async function fetchUsers() {
      const pb = getPocketBase();
      try {
        const result = await pb.collection('users').getList<User>(1, 100, { sort: '-created' });
        setUsers(result.items);
      } catch (err) {
        console.error('获取用户失败：', err);
        setError('用户列表加载失败，请确认当前账号拥有超级管理员权限。');
      } finally {
        setLoading(false);
      }
    }

    fetchUsers();
  }, []);

  const updateRole = async (targetUser: User, role: AdminRole) => {
    if (targetUser.role === role) return;

    if (targetUser.role === 'super_admin' && role !== 'super_admin' && superAdminCount <= 1) {
      setError('至少需要保留一个超级管理员。');
      return;
    }

    const label = roleLabels[role] || role;
    setConfirmState({ open: true, title: '确认操作', message: `确定把 ${targetUser.name || targetUser.email} 的角色改为 ${label} 吗？`, onConfirm: async () => {
      setUpdatingId(targetUser.id);
      setError('');

      try {
        const pb = getPocketBase();
        const updated = await pb.collection('users').update<User>(targetUser.id, { role });
        setUsers((items) => items.map((item) => item.id === targetUser.id ? { ...item, ...updated } : item));
        showToast('角色更新成功', 'success');
      } catch (err) {
        console.error('更新用户角色失败：', err);
        setError('角色更新失败，请确认当前账号仍拥有超级管理员权限。');
        showToast('角色更新失败', 'error');
      } finally {
        setUpdatingId('');
      }
    }});
  };

  if (loading) {
    return <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-md border border-border bg-white" />)}</div>;
  }

  const deleteUser = (targetUser: User) => {
    if (targetUser.role === 'super_admin' && superAdminCount <= 1) {
      setError('至少需要保留一个超级管理员，无法删除。');
      return;
    }
    if (targetUser.id === currentUser?.id) {
      setError('不能删除当前登录的账号。');
      return;
    }
    setConfirmState({ open: true, title: '确认删除用户', message: `确定删除用户 ${targetUser.name || targetUser.email} 吗？此操作无法撤销，该用户的评论记录会保留。`, onConfirm: async () => {
      setDeletingId(targetUser.id);
      setError('');
      try {
        const pb = getPocketBase();
        await pb.collection('users').delete(targetUser.id);
        setUsers((items) => items.filter((item) => item.id !== targetUser.id));
        showToast('用户已删除', 'success');
      } catch (err) {
        console.error('删除用户失败：', err);
        setError('删除失败，请确认当前账号仍拥有超级管理员权限。');
        showToast('删除用户失败', 'error');
      } finally {
        setDeletingId('');
      }
    }});
  };

  const filteredUsers = (() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return users;
    return users.filter((u) => [u.name, u.email].some((v) => String(v || '').toLowerCase().includes(keyword)));
  })();

  if (users.length === 0) {
    return <div className="card rounded-md p-6 text-sm text-text-secondary [overflow-wrap:anywhere]">没有找到用户。</div>;
  }

  if (filteredUsers.length === 0) {
    return (
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-text-secondary">共 0 / {users.length} 个用户</p>
          <label className="relative w-full sm:w-72">
            <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 21l-4.35-4.35M11 18a7 7 0 110-14 7 7 0 010 14z" /></svg>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索姓名或邮箱" className="h-10 w-full rounded-md border border-border bg-bg-soft pl-9 pr-3 text-sm text-text outline-none transition focus:border-accent focus:bg-white" />
          </label>
        </div>
        <div className="card rounded-md p-12 text-center text-sm text-text-secondary">没有匹配的用户。</div>
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
    <div className="min-w-0 space-y-3 sm:overflow-hidden sm:rounded-md sm:border sm:border-border sm:bg-white sm:shadow-none">
      {error && (
        <div className="rounded-md border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger [overflow-wrap:anywhere] sm:rounded-none sm:border-x-0 sm:border-t-0" role="alert">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-text-secondary">共 {filteredUsers.length}{query ? ` / ${users.length}` : ''} 个用户</p>
        <label className="relative w-full sm:w-72">
          <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 21l-4.35-4.35M11 18a7 7 0 110-14 7 7 0 010 14z" /></svg>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索姓名或邮箱" className="h-10 w-full rounded-md border border-border bg-bg-soft pl-9 pr-3 text-sm text-text outline-none transition focus:border-accent focus:bg-white" />
        </label>
      </div>

      <div className="hidden grid-cols-[minmax(0,1fr)_minmax(9rem,auto)_auto] gap-4 border-b border-border bg-bg-soft px-4 py-2.5 font-mono text-[10px] uppercase text-muted sm:grid">
        <span>用户</span>
        <span>角色分配</span>
        <span className="hidden w-24 text-right sm:block">加入时间</span>
      </div>

      <motion.div variants={listVariants} initial="hidden" animate="visible" className="space-y-3 sm:divide-y sm:divide-border sm:space-y-0">
        {filteredUsers.map((user) => {
          const isLastSuperAdmin = user.role === 'super_admin' && superAdminCount <= 1;
          const isUpdating = updatingId === user.id;
          const isDeleting = deletingId === user.id;
          const canModify = currentUser?.role === 'super_admin' && user.id !== currentUser?.id;

          return (
            <motion.div
              key={user.id}
              variants={itemVariants}
              className="grid grid-cols-[minmax(0,1fr)] items-center gap-3 rounded-md border border-border bg-white p-3 shadow-xs transition-colors hover:bg-bg-soft/70 sm:rounded-none sm:border-0 sm:bg-transparent sm:px-4 sm:py-3 sm:shadow-none sm:grid-cols-[minmax(0,1fr)_minmax(9rem,auto)_6rem]"
            >
              <div className="flex min-w-0 items-center gap-3">
                {user.avatar ? (
                  <img
                    src={user.avatar.startsWith('http') ? user.avatar : getPocketBase().files.getUrl(user as any, user.avatar)}
                    alt=""
                    className="h-9 w-9 shrink-0 rounded-md object-cover"
                    onError={(event) => { (event.target as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : (
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-text text-xs font-semibold text-white">
                    {user.name?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="break-words text-sm font-semibold text-text [overflow-wrap:anywhere]">{user.name || '未命名用户'}</p>
                    {user.verified ? (
                      <span className="rounded border border-success/30 bg-success/10 px-1.5 py-0.5 font-mono text-[9px] uppercase text-success" title="邮箱已验证">已验证</span>
                    ) : (
                      <span className="rounded border border-warning/30 bg-warning/10 px-1.5 py-0.5 font-mono text-[9px] uppercase text-warning" title="邮箱未验证">未验证</span>
                    )}
                  </div>
                  <p className="break-all font-mono text-[10px] text-muted [overflow-wrap:anywhere]">{user.email || '无邮箱'}</p>
                </div>
              </div>

              <div className="flex min-w-0 flex-wrap items-stretch gap-2 min-[390px]:items-center">
                <span className={'rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase ' + (roleColors[user.role] || 'bg-bg-soft text-text-secondary border-border')}>
                  {roleLabels[user.role] || user.role}
                </span>
                <select
                  value={user.role}
                  onChange={(event) => updateRole(user, event.target.value as AdminRole)}
                  disabled={isUpdating || isLastSuperAdmin || currentUser?.role !== 'super_admin'}
                  title={isLastSuperAdmin ? '不能降级最后一个超级管理员' : '修改用户角色'}
                  className="min-h-10 min-w-0 flex-1 rounded-md border border-border bg-white px-2 py-1 text-xs text-text outline-none transition-colors hover:border-border-hover disabled:cursor-not-allowed disabled:opacity-60 min-[390px]:flex-none"
                >
                  <option value="reader">普通用户</option>
                  <option value="author">作者</option>
                  <option value="admin">管理员</option>
                  <option value="super_admin">超级管理员</option>
                </select>
                <button
                  onClick={() => deleteUser(user)}
                  disabled={!canModify || isDeleting || isLastSuperAdmin}
                  title={isLastSuperAdmin ? '不能删除最后一个超级管理员' : !canModify ? '无权限' : '删除用户'}
                  aria-label="删除用户"
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isDeleting ? (
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  ) : (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  )}
                </button>
              </div>

              <span className="hidden text-right text-xs text-text-secondary sm:block">{new Date(user.created).toLocaleDateString('zh-CN')}</span>
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
