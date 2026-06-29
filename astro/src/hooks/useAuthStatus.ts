import { useCallback, useEffect, useState } from 'react';
import { getPocketBase } from '../lib/pocketbase';
import type { User, UserRole } from '../types/pocketbase';

export const ROLE_LABELS: Record<UserRole, string> = {
  reader: '普通用户',
  author: '作者',
  admin: '管理员',
  super_admin: '超级管理员',
};

const ROLE_RANK: Record<UserRole, number> = {
  reader: 0,
  author: 1,
  admin: 2,
  super_admin: 3,
};

function readUser(): User | null {
  const pb = getPocketBase();
  return pb.authStore.isValid && pb.authStore.record
    ? (pb.authStore.record as unknown as User)
    : null;
}

export function getUserDisplayName(user: User | null): string {
  if (!user) return '';
  return user.name?.trim() || user.email || '已登录用户';
}

export function getUserInitial(user: User | null): string {
  const name = getUserDisplayName(user);
  return name.charAt(0).toUpperCase() || 'U';
}

export function userCanAccessAdmin(user: User | null): boolean {
  if (!user?.role) return false;
  return ROLE_RANK[user.role] >= ROLE_RANK.author;
}

export function useAuthStatus() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const pb = getPocketBase();

    const sync = () => {
      if (!mounted) return;
      setUser(readUser());
    };

    const unsubscribe = pb.authStore.onChange(sync);

    const refreshAuth = async () => {
      if (pb.authStore.isValid && pb.authStore.record) {
        try {
          await pb.collection('users').authRefresh();
        } catch {
          pb.authStore.clear();
        }
      }

      sync();
      if (mounted) setIsLoading(false);
    };

    refreshAuth();

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  const logout = useCallback((redirectTo?: string) => {
    getPocketBase().authStore.clear();
    if (redirectTo) window.location.href = redirectTo;
  }, []);

  return {
    user,
    isAuthenticated: !!user,
    isLoading,
    logout,
    canAccessAdmin: userCanAccessAdmin(user),
  };
}
