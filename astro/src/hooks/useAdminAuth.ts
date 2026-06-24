import { useState, useEffect } from 'react';
import { getPocketBase } from '../lib/pocketbase';
import type { User } from '../types/pocketbase';

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
    const pb = getPocketBase();
    if (pb.authStore.isValid && pb.authStore.record) {
      setUser(pb.authStore.record as unknown as User);
    }
    const unsubscribe = pb.authStore.onChange(() => {
      if (pb.authStore.isValid && pb.authStore.record) {
        setUser(pb.authStore.record as unknown as User);
      } else {
        setUser(null);
      }
    });
    setIsLoading(false);
    return () => { unsubscribe?.(); };
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
