import { useState, useEffect, useCallback } from 'react';
import { settingsService, type SiteSettings, DEFAULT_SITE_SETTINGS } from '../../lib/services/settingsService';
import { showToast } from '../../components/ui/Toast';

export function useSettings() {
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS);
  const [loading, setLoading] = useState(true);
  /** 加载是否成功过。未成功加载前不允许保存，避免默认值覆盖线上设置。 */
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const data = await settingsService.getAllSettings();
      setSettings(data);
      setLoaded(true);
      setError(null);
    } catch (err) {
      // 失败只记录错误，不把默认值当成已加载结果；即使本次之前曾经加载成功，
      // 失败后也必须重新置为「未加载」，禁止保存直到下一次加载成功。
      setLoaded(false);
      setError(err instanceof Error && err.message ? err.message : '加载设置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const saveSettings = useCallback(async () => {
    if (!loaded) {
      showToast('设置尚未加载成功，请重试后再保存', 'error');
      return;
    }
    setSaving(true);
    try {
      await settingsService.saveSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('保存设置失败：', err);
      showToast('保存设置失败', 'error');
    } finally {
      setSaving(false);
    }
  }, [settings, loaded]);

  const updateSetting = useCallback(<K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  }, []);

  return {
    settings,
    loading,
    loaded,
    error,
    retry: loadSettings,
    saving,
    saved,
    saveSettings,
    updateSetting,
  };
}
