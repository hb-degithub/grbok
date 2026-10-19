import { useCallback, useEffect, useState } from 'react';
import {
  aiErrorCode,
  getAiSettings,
  saveAiSettings,
  testAiConnection,
  type AiSettings,
  type AiSettingsInput,
  type AiTestResult,
} from '../../lib/services/aiSettingsService';
import { describePbError } from '../../lib/pb-error';

interface RequestError {
  message?: string;
  response?: { data?: { code?: string; message?: string } };
}

const ERROR_MESSAGES: Record<string, string> = {
  AI_NOT_CONFIGURED: '尚未完成接入配置或功能未启用',
  AI_TIMEOUT: '上游响应超时',
  AI_AUTH_FAILED: 'API Key 无效或未授权',
  AI_UPSTREAM_BUSY: '上游限流，请稍后重试',
  AI_UPSTREAM_ERROR: '上游服务错误',
  AI_BAD_RESPONSE: 'AI 返回格式异常',
  INVALID_AI_CONFIG: '配置校验失败',
  AI_RATE_LIMITED: '操作过于频繁，请稍后重试',
};

/** AI 错误码 → 中文提示；无法识别时退回 describePbError */
export function describeAiError(error: unknown, fallback = 'AI 配置操作失败'): string {
  const code = aiErrorCode(error);
  if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  return describePbError(error, (error as RequestError | undefined)?.message || fallback);
}

export function useAiSettings() {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AiTestResult | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setSettings(await getAiSettings());
    } catch (err) {
      setError(describeAiError(err, '无法读取 AI 配置'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async (input: AiSettingsInput) => {
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      const view = await saveAiSettings(input);
      setSettings(view);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      return view;
    } catch (err) {
      setError(describeAiError(err, '保存 AI 配置失败'));
      throw err;
    } finally {
      setSaving(false);
    }
  }, []);

  const test = useCallback(async () => {
    setTesting(true);
    setError('');
    setTestResult(null);
    try {
      const result = await testAiConnection();
      setTestResult(result);
      if (!result.ok) setError(ERROR_MESSAGES[result.error] || result.message || '连接测试失败');
      return result;
    } catch (err) {
      setError(describeAiError(err, '连接测试失败'));
      throw err;
    } finally {
      setTesting(false);
    }
  }, []);

  return {
    settings,
    loading,
    saving,
    saved,
    testing,
    testResult,
    error,
    setError,
    load,
    save,
    test,
    dismissMessages: useCallback(() => { setError(''); setSaved(false); setTestResult(null); }, []),
  };
}
