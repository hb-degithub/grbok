import React, { useState, useEffect } from 'react';
import { getPocketBase } from '../lib/pocketbase';
import type { User } from '../../types/pocketbase';

export type AdminRole = 'admin' | 'author';

export interface AdminAuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: User | null;
  hasPermission: (requiredRole: AdminRole) => boolean;
}

export function useAdminAuth(): AdminAuthState {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const pb = getPocketBase();

    const checkAuth = async () => {
      try {
        // 测试连接
        await pb.collection('_superusers').getList(1, 1);
      } catch {
        // 连接失败不影响已有登录状态
      }

      if (pb.authStore.isValid && pb.authStore.record) {
        if (mounted) setUser(pb.authStore.record as unknown as User);
      }

      const unsubscribe = pb.authStore.onChange(() => {
        if (mounted) {
          if (pb.authStore.isValid && pb.authStore.record) {
            setUser(pb.authStore.record as unknown as User);
          } else {
            setUser(null);
          }
        }
      });

      if (mounted) setIsLoading(false);
      return () => { unsubscribe?.(); };
    };

    checkAuth();

    return () => { mounted = false; };
  }, []);

  const hasPermission = (requiredRole: AdminRole): boolean => {
    if (!user) return false;
    if (requiredRole === 'author') return user.role === 'admin' || user.role === 'author';
    if (requiredRole === 'admin') return user.role === 'admin';
    return false;
  };

  return { isAuthenticated: !!user, isLoading, user, hasPermission };
}

export function useAdminLogout() {
  return {
    logout: () => {
      getPocketBase().authStore.clear();
      window.location.href = '/login';
    },
  };
}
