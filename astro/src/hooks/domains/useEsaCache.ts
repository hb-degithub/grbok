import { useCallback, useEffect, useState } from 'react';
import {
  getEsaConfig,
  listEsaTasks,
  purgeEsaCacheAll,
  purgeEsaCacheUrls,
  saveEsaConfig,
  type EsaConfigInput,
  type EsaConfigView,
  type EsaTaskItem,
} from '../../lib/services/esaCacheService';

interface RequestError {
  message?: string;
  response?: { data?: { code?: string } };
}

const ERROR_MESSAGES: Record<string, string> = {
  ESA_NOT_CONFIGURED: '尚未配置或启用 ESA 凭证，请先完成配置',
  ESA_CONFIG_INVALID: '配置格式不正确，请检查 AccessKey 与站点 ID',
  ESA_PURGE_RATE_LIMITED: '操作过于频繁，请稍后重试',
  ESA_RATE_LIMITED: 'ESA 接口限流，请稍后重试',
  ESA_QUOTA_EXCEEDED: '今日刷新配额已用尽',
  ESA_PAYLOAD_INVALID: '请求内容不合法',
  INVALID_PURGE_URL: '存在不合法的刷新地址（仅限本站 https:// 链接）',
  ESA_UPSTREAM_ERROR: 'ESA 服务暂时不可用，请稍后重试',
};

export function describeEsaError(error: unknown): string {
  const err = error as RequestError | undefined;
  const code = err?.response?.data?.code;
  if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  return err?.message || '操作失败，请稍后重试';
}

export function useEsaCache() {
  const [config, setConfig] = useState<EsaConfigView | null>(null);
  const [tasks, setTasks] = useState<EsaTaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [purging, setPurging] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [configView, taskList] = await Promise.all([getEsaConfig(), listEsaTasks()]);
      setConfig(configView);
      setTasks(taskList.items);
    } catch (err) {
      setError(describeEsaError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async (input: EsaConfigInput) => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const view = await saveEsaConfig(input);
      setConfig(view);
      setNotice('ESA 凭证配置已保存');
    } catch (err) {
      setError(describeEsaError(err));
      throw err;
    } finally {
      setSaving(false);
    }
  }, []);

  const refreshTasks = useCallback(async () => {
    try {
      const taskList = await listEsaTasks();
      setTasks(taskList.items);
    } catch {
      // 记录刷新失败不阻断主界面
    }
  }, []);

  const purgeAll = useCallback(async () => {
    setPurging(true);
    setError('');
    setNotice('');
    try {
      const result = await purgeEsaCacheAll();
      setNotice('全站缓存刷新任务已提交');
      await refreshTasks();
      return result;
    } catch (err) {
      setError(describeEsaError(err));
      throw err;
    } finally {
      setPurging(false);
    }
  }, [refreshTasks]);

  const purgeUrls = useCallback(async (urls: string[]) => {
    setPurging(true);
    setError('');
    setNotice('');
    try {
      const result = await purgeEsaCacheUrls(urls);
      setNotice('指定路径缓存刷新任务已提交');
      await refreshTasks();
      return result;
    } catch (err) {
      setError(describeEsaError(err));
      throw err;
    } finally {
      setPurging(false);
    }
  }, [refreshTasks]);

  return {
    config,
    tasks,
    loading,
    saving,
    purging,
    error,
    notice,
    reload: load,
    save,
    purgeAll,
    purgeUrls,
    refreshTasks,
    dismissMessages: useCallback(() => { setError(''); setNotice(''); }, []),
  };
}
