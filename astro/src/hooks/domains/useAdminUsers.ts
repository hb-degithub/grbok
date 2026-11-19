import { useState, useEffect, useCallback } from 'react';
import { adminUserService, type AdminUser } from '../../lib/services/adminUserService';
import { buildFileUrl } from '../../lib/pocketbase';
import type { AdminRole } from '../useAdminAuth';

function avatarUrlOf(user: AdminUser): string {
  if (!user.avatar) return '';
  return user.avatar.startsWith('http') ? user.avatar : buildFileUrl('users', user.id, user.avatar);
}

/** 与 adminUserService.getUsers 的默认 perPage 保持一致，分页 UI 也复用它。 */
export const USERS_PER_PAGE = 20;

function lastPageOf(totalItems: number): number {
  return Math.max(1, Math.ceil(totalItems / USERS_PER_PAGE));
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
      const requestedPage = Math.max(1, pageNum);
      let result = await adminUserService.getUsers(requestedPage, USERS_PER_PAGE);
      let effectivePage = requestedPage;

      // 删除末页最后一个用户后，请求页会越界：PB 返回空 items 且 totalItems 已经缩小。
      // 这里按真实总数把页码 clamp 到实际最后一页并重新请求，避免停留在空白页。
      if (result.items.length === 0 && requestedPage > 1) {
        const lastPage = lastPageOf(result.totalItems);
        if (lastPage < requestedPage) {
          effectivePage = lastPage;
          result = await adminUserService.getUsers(effectivePage, USERS_PER_PAGE);
        }
      }

      setUsers(result.items);
      setTotalItems(result.totalItems);
      setPage(effectivePage);
    } catch (err) {
      // 失败只记录错误：保留已有的 users/totalItems/page，重试时仍停留在当前页，
      // 也不会因为一次失败把统计伪造成「共 0 个用户」。
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const getAvatarUrl = useCallback((user: AdminUser) => avatarUrlOf(user), []);

  // 页内 super_admin 数量（_superAdminCount）只是当前页统计，不是权限依据；
  // 是否允许降级/删除最后一个超级管理员由服务端规则判定，前端不做安全拦截。
  const updateRole = useCallback(async (targetUser: AdminUser, role: AdminRole, _superAdminCount?: number) => {
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

  const deleteUser = useCallback(async (targetUser: AdminUser, _superAdminCount?: number, _currentUserId?: string) => {
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
