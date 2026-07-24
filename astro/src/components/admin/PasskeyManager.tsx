import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useAdminAuth } from '../../hooks/useAdminAuth';
import {
  listAdminPasskeys,
  registerAdminPasskey,
  revokeAdminPasskey,
  type AdminPasskeyDto,
} from '../../lib/admin-passkey';
import Button from '../ui/Button';
import Input from '../ui/Input';

export default function PasskeyManager() {
  const { user } = useAdminAuth();
  const [passkeys, setPasskeys] = useState<AdminPasskeyDto[]>([]);
  const [label, setLabel] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isRevoking, setIsRevoking] = useState<string | null>(null);
  const [error, setError] = useState('');
  const isSuperAdmin = user?.role === 'super_admin';

  const loadPasskeys = async () => {
    setIsLoading(true);
    setError('');
    try {
      const result = await listAdminPasskeys();
      setPasskeys(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载 Passkey 失败');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { if (isSuperAdmin) void loadPasskeys(); }, [isSuperAdmin]);

  const handleRegister = async () => {
    if (!label.trim()) { setError('请输入 Passkey 标签'); return; }
    setIsRegistering(true);
    setError('');
    try {
      await registerAdminPasskey(label.trim());
      setLabel('');
      await loadPasskeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册 Passkey 失败');
    } finally {
      setIsRegistering(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setIsRevoking(id);
    setError('');
    try {
      await revokeAdminPasskey(id);
      await loadPasskeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : '撤销 Passkey 失败');
    } finally {
      setIsRevoking(null);
    }
  };

  if (!isSuperAdmin) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card rounded-xl p-5 sm:p-6">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-text">管理员 Passkey</h2>
        <p className="text-sm text-text-secondary">通过专用安全 API 注册和撤销凭据。</p>
      </div>

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        <Input label="Passkey 标签" placeholder="例如：MacBook Pro" value={label} onChange={(event) => setLabel(event.target.value)} className="flex-1" />
        <div className="flex items-end">
          <Button onClick={handleRegister} loading={isRegistering} disabled={isRegistering} className="w-full sm:w-auto">注册新 Passkey</Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8"><div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-zinc-500" /></div>
      ) : passkeys.length === 0 ? (
        <p className="text-sm text-text-secondary">暂无已注册的 Passkey。</p>
      ) : (
        <ul className="space-y-3">
          {passkeys.map((passkey, index) => (
            <motion.li key={passkey.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50/50 p-4 dark:border-zinc-700 dark:bg-zinc-800/40">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text">{passkey.label || '未命名 Passkey'}</p>
                <p className="text-xs text-muted">创建于 {new Date(passkey.created).toLocaleString('zh-CN')}</p>
                {passkey.revokedAt && <p className="text-xs text-red-600">已撤销</p>}
              </div>
              <Button variant="outline" size="sm" loading={isRevoking === passkey.id} disabled={isRevoking === passkey.id || !!passkey.revokedAt || passkey.current} onClick={() => handleRevoke(passkey.id)} className="shrink-0">
                {passkey.current ? '保留最后一枚' : passkey.revokedAt ? '已撤销' : '撤销'}
              </Button>
            </motion.li>
          ))}
        </ul>
      )}
    </motion.div>
  );
}
