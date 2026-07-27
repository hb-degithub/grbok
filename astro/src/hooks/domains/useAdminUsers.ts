import { useState, useEffect, useCallback } from 'react';
import { adminUserService, type AdminUser } from '../../lib/services/adminUserService';

export function useAdminUsers() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

  const updateUserRole = useCallback(async (id: string, role: AdminUser['role']) => {
    try {
      await adminUserService.updateUserRole(id, role);
      await loadUsers(page);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新失败');
      return false;
    }
  }, [page, loadUsers]);

  const deleteUser = useCallback(async (id: string) => {
    try {
      await adminUserService.deleteUser(id);
      await loadUsers(page);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
      return false;
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
    page,
    totalItems,
    loadUsers,
    updateUserRole,
    deleteUser,
    createUser,
  };
}
