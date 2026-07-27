import { useState, useEffect, useCallback } from 'react';
import { settingsService, type SiteSettings, DEFAULT_SITE_SETTINGS } from '../../lib/services/settingsService';
import { showToast } from '../../components/ui/Toast';

export function useSettings() {
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const data = await settingsService.getAllSettings();
        setSettings(data);
      } catch (err) {
        console.error('加载设置失败：', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const saveSettings = useCallback(async () => {
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
  }, [settings]);

  const updateSetting = useCallback(<K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  }, []);

  return {
    settings,
    loading,
    saving,
    saved,
    saveSettings,
    updateSetting,
  };
}