import { useState, useCallback } from 'react';
import { authService, type User, type AuthResponse } from '../../lib/services/authService';

export function useAuth() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(async (email: string, password: string): Promise<AuthResponse | null> => {
    setLoading(true);
    setError(null);
    try {
      const result = await authService.loginWithPassword(email, password);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : '登录失败';
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const confirmVerification = useCallback(async (token: string): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      await authService.confirmVerification(token);
      await authService.refreshAuth();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : '验证失败';
      setError(message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const requestPasswordReset = useCallback(async (email: string): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      await authService.requestPasswordReset(email);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : '请求失败';
      setError(message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const requestVerification = useCallback(async (email: string): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      await authService.requestVerification(email);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : '请求失败';
      setError(message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    authService.logout();
  }, []);

  const isAuthenticated = useCallback(() => {
    return authService.isAuthenticated();
  }, []);

  const getCurrentUser = useCallback((): User | null => {
    return authService.getCurrentUser();
  }, []);

  return {
    loading,
    error,
    login,
    confirmVerification,
    requestPasswordReset,
    requestVerification,
    logout,
    isAuthenticated,
    getCurrentUser,
  };
}
