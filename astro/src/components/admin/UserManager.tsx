import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { getPocketBase } from '../../lib/pocketbase';
import type { User } from '../../types/pocketbase';

const roleColors: Record<string, string> = {
  admin: 'bg-danger/15 text-danger border-red-500/30',
  author: 'bg-accent/15 text-accent border-accent/30',
  reader: 'bg-text-muted/15 text-text-muted border-text-muted/30',
};

export default function UserManager() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchUsers() {
      const pb = getPocketBase();
      try { const result = await pb.collection('users').getList<User>(1, 100, { sort: '-created' }); setUsers(result.items); }
      catch (err) { console.error('Failed to fetch users:', err); }
      finally { setLoading(false); }
    }
    fetchUsers();
  }, []);

  if (loading) return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-bg-soft" />)}</div>;

  return (
    <div className="space-y-3">
      {users.map((user) => (
        <motion.div key={user.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card flex items-center gap-4 rounded-xl p-4">
          {user.avatar ? (
            <img src={user.avatar.startsWith('http') ? user.avatar : getPocketBase().files.getUrl(user as any, user.avatar)} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-white">{user.name?.charAt(0)?.toUpperCase() || '?'}</div>
          )}
          <div className="min-w-0 flex-1"><p className="font-medium text-text">{user.name || 'Unnamed'}</p><p className="font-mono text-[10px] text-muted">{user.email}</p></div>
          <span className={'rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase ' + (roleColors[user.role] || '')}>{user.role}</span>
          <span className="text-xs text-text-secondary">{new Date(user.created).toLocaleDateString('zh-CN')}</span>
        </motion.div>
      ))}
    </div>
  );
}
