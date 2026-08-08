import { useState, useEffect, useCallback } from 'react';
import { adminUserService, type AdminUser } from '../../lib/services/adminUserService';
import type { AdminRole } from '../useAdminAuth';

function avatarUrlOf(user: AdminUser): string {
  if (!user.avatar) return '';
  return user.avatar.startsWith('http') ? user.avatar : `${import.meta.env.PUBLIC_POCKETBASE_URL || ''}/api/files/users/${user.id}/${user.avatar}`;
}

export function useAdminUsers() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  const loadUsers = useCallback(async (pageNum = 1) => {
    setLoading(true);
    setError(null);
    try {
      const result = await adminUserService.getUsers(pageNum);
      setUsers(result.items);
      setTotalItems(result.totalItems);
      setPage(pageNum);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const getAvatarUrl = useCallback((user: AdminUser) => avatarUrlOf(user), []);

  const updateRole = useCallback(async (targetUser: AdminUser, role: AdminRole, _superAdminCount: number) => {
    setUpdatingId(targetUser.id);
    setError(null);
    try {
      await adminUserService.updateUserRole(targetUser.id, role as AdminUser['role']);
      await loadUsers(page);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新角色失败');
      return false;
    } finally {
      setUpdatingId(null);
    }
  }, [page, loadUsers]);

  const deleteUser = useCallback(async (targetUser: AdminUser, _superAdminCount: number, _currentUserId?: string) => {
    setDeletingId(targetUser.id);
    setError(null);
    try {
      await adminUserService.deleteUser(targetUser.id);
      await loadUsers(page);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
      return false;
    } finally {
      setDeletingId(null);
    }
  }, [page, loadUsers]);

  const createUser = useCallback(async (data: { email: string; password: string; passwordConfirm: string; name?: string; role?: string }) => {
    try {
      await adminUserService.createUser(data);
      await loadUsers(page);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
      return false;
    }
  }, [page, loadUsers]);

  return {
    users,
    loading,
    error,
    setError,
    updatingId,
    deletingId,
    page,
    totalItems,
    loadUsers,
    updateRole,
    deleteUser,
    createUser,
    getAvatarUrl,
  };
}
