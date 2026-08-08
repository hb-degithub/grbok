import { useState, useEffect, useCallback } from 'react';
import { featureFlagService, type FeatureFlag } from '../../lib/services/featureFlagService';

export function useFeatureFlags() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFlags = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await featureFlagService.getFlags();
      setFlags(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFlags();
  }, [loadFlags]);

  const toggleFlag = useCallback(async (key: string, enabled: boolean) => {
    try {
      await featureFlagService.setFlag(key, enabled);
      await loadFlags();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
      return false;
    }
  }, [loadFlags]);

  const createFlag = useCallback(async (data: Omit<FeatureFlag, 'id' | 'created' | 'updated'>) => {
    try {
      await featureFlagService.createFlag(data);
      await loadFlags();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
      return false;
    }
  }, [loadFlags]);

  const updateFlag = useCallback(async (id: string, data: Partial<FeatureFlag>) => {
    try {
      await featureFlagService.updateFlag(id, data);
      await loadFlags();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新失败');
      return false;
    }
  }, [loadFlags]);

  const deleteFlag = useCallback(async (id: string) => {
    try {
      await featureFlagService.deleteFlag(id);
      await loadFlags();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
      return false;
    }
  }, [loadFlags]);

  /** 新建或更新（依据 data 是否含 id） */
  const saveFlag = useCallback(async (data: Omit<FeatureFlag, 'id' | 'created' | 'updated'> & { id?: string }) => {
    setSaving(true);
    try {
      if (data.id) {
        await featureFlagService.updateFlag(data.id, data);
      } else {
        await featureFlagService.createFlag(data);
      }
      await loadFlags();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
      return false;
    } finally {
      setSaving(false);
    }
  }, [loadFlags]);

  return {
    flags,
    loading,
    saving,
    error,
    loadFlags,
    toggleFlag,
    createFlag,
    updateFlag,
    deleteFlag,
    saveFlag,
  };
}
