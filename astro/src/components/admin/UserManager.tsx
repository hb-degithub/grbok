import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { getPocketBase } from '../../lib/pocketbase';
import { useAdminAuth, type AdminRole } from '../../hooks/useAdminAuth';
import type { User } from '../../types/pocketbase';

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
  const [updatingId, setUpdatingId] = useState('');
  const [error, setError] = useState('');
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
    if (!confirm(`确定把 ${targetUser.name || targetUser.email} 的角色改为 ${label} 吗？`)) return;

    setUpdatingId(targetUser.id);
    setError('');

    try {
      const pb = getPocketBase();
      const updated = await pb.collection('users').update<User>(targetUser.id, { role });
      setUsers((items) => items.map((item) => item.id === targetUser.id ? { ...item, ...updated } : item));
    } catch (err) {
      console.error('更新用户角色失败：', err);
      setError('角色更新失败，请确认当前账号仍拥有超级管理员权限。');
    } finally {
      setUpdatingId('');
    }
  };

  if (loading) {
    return <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-md border border-border bg-white" />)}</div>;
  }

  if (users.length === 0) {
    return <div className="card rounded-md p-6 text-sm text-text-secondary [overflow-wrap:anywhere]">没有找到用户。</div>;
  }

  return (
    <div className="min-w-0 space-y-3 sm:overflow-hidden sm:rounded-md sm:border sm:border-border sm:bg-white sm:shadow-none">
      {error && (
        <div className="rounded-md border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger [overflow-wrap:anywhere] sm:rounded-none sm:border-x-0 sm:border-t-0" role="alert">
          {error}
        </div>
      )}

      <div className="hidden grid-cols-[minmax(0,1fr)_minmax(9rem,auto)_auto] gap-4 border-b border-border bg-bg-soft px-4 py-2.5 font-mono text-[10px] uppercase text-muted sm:grid">
        <span>用户</span>
        <span>角色分配</span>
        <span className="hidden w-24 text-right sm:block">加入时间</span>
      </div>

      <div className="space-y-3 sm:divide-y sm:divide-border sm:space-y-0">
        {users.map((user) => {
          const isLastSuperAdmin = user.role === 'super_admin' && superAdminCount <= 1;
          const isUpdating = updatingId === user.id;

          return (
            <motion.div
              key={user.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
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
                  <p className="break-words text-sm font-semibold text-text [overflow-wrap:anywhere]">{user.name || '未命名用户'}</p>
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
              </div>

              <span className="hidden text-right text-xs text-text-secondary sm:block">{new Date(user.created).toLocaleDateString('zh-CN')}</span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
