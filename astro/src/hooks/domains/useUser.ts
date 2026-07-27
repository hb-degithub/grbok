import { useState, useCallback } from 'react';
import { userService, type ReaderRegisterData } from '../../lib/services/userService';

export function useUser() {
  const [loading, setLoading] = useState(false);

  const registerReader = useCallback(async (data: ReaderRegisterData) => {
    setLoading(true);
    try {
      return await userService.registerReader(data);
    } finally {
      setLoading(false);
    }
  }, []);

  const requestVerification = useCallback(async (email: string) => {
    setLoading(true);
    try {
      return await userService.requestVerification(email);
    } finally {
      setLoading(false);
    }
  }, []);

  const isLoggedIn = useCallback(() => {
    return userService.isLoggedIn();
  }, []);

  return {
    loading,
    registerReader,
    requestVerification,
    isLoggedIn,
  };
}
