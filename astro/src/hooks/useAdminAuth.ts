import React, { useState, useEffect } from 'react';
import { getPocketBase } from '../lib/pocketbase';
import type { User } from '../types/pocketbase';

export type AdminRole = 'reader' | 'author' | 'admin' | 'super_admin';

const ROLE_RANK: Record<AdminRole, number> = {
  reader: 0,
  author: 1,
  admin: 2,
  super_admin: 3,
};

function normalizeRole(role: unknown): AdminRole | null {
  return typeof role === 'string' && role in ROLE_RANK ? (role as AdminRole) : null;
}

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
    let unsubscribe: (() => void) | undefined;

    const checkAuth = async () => {
      // 1. Quickly check whether a local token exists and has not expired.
      const hasLocalToken = pb.authStore.isValid && pb.authStore.record;

      if (hasLocalToken) {
        // 2. Refresh with the server so revoked or expired tokens are rejected.
        try {
          await pb.collection('users').authRefresh();
          if (mounted) setUser(pb.authStore.record as unknown as User);
        } catch (err) {
          // Invalid token: clear the local auth store.
          pb.authStore.clear();
          if (mounted) setUser(null);
          console.warn('Admin token is invalid and has been cleared.', err);
        }
      }

      // 3. Listen for auth changes, including logout or another tab updating auth.
      unsubscribe = pb.authStore.onChange(() => {
        if (!mounted) return;
        if (pb.authStore.isValid && pb.authStore.record) {
          setUser(pb.authStore.record as unknown as User);
        } else {
          setUser(null);
        }
      });

      if (mounted) setIsLoading(false);
    };

    checkAuth();

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  const hasPermission = (requiredRole: AdminRole): boolean => {
    if (!user) return false;

    const userRole = normalizeRole(user.role);
    if (!userRole) return false;

    const backendMinimumRole: AdminRole = 'author';
    const requiredRank = Math.max(ROLE_RANK[requiredRole], ROLE_RANK[backendMinimumRole]);
    return ROLE_RANK[userRole] >= requiredRank;
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
