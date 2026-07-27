import { useState, useEffect, useCallback } from 'react';
import { mailService, type MailMessage, type SmtpConfig, type MailTemplate } from '../../lib/services/mailService';

export type TabKey = 'messages' | 'smtp' | 'templates';

export function useMailCenter() {
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  const loadMessages = useCallback(async (pageNum = 1) => {
    setLoading(true);
    setError(null);
    try {
      const result = await mailService.getMessages(pageNum);
      setMessages(result.items);
      setTotalItems(result.totalItems);
      setPage(pageNum);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  const sendMessage = useCallback(async (data: { to: string; subject: string; body: string }) => {
    try {
      await mailService.sendMessage(data);
      await loadMessages(page);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败');
      return false;
    }
  }, [loadMessages, page]);

  const retryMessage = useCallback(async (id: string) => {
    try {
      await mailService.retryMessage(id);
      await loadMessages(page);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '重试失败');
      return false;
    }
  }, [loadMessages, page]);

  const deleteMessage = useCallback(async (id: string) => {
    try {
      await mailService.deleteMessage(id);
      await loadMessages(page);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
      return false;
    }
  }, [loadMessages, page]);

  return {
    messages,
    loading,
    error,
    page,
    totalItems,
    loadMessages,
    sendMessage,
    retryMessage,
    deleteMessage,
  };
}

export function useSmtpConfig() {
  const [config, setConfig] = useState<SmtpConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    mailService.getSmtpConfig()
      .then(setConfig)
      .catch(() => setConfig(null))
      .finally(() => setLoading(false));
  }, []);

  const saveConfig = useCallback(async (newConfig: SmtpConfig) => {
    setSaving(true);
    setError(null);
    try {
      await mailService.saveSmtpConfig(newConfig);
      setConfig(newConfig);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  return { config, loading, saving, error, saveConfig };
}

export function useMailTemplate() {
  const [templates, setTemplates] = useState<MailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const result = await mailService.getTemplates();
      setTemplates(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const saveTemplate = useCallback(async (data: Partial<MailTemplate> & { id?: string }) => {
    try {
      await mailService.saveTemplate(data);
      await loadTemplates();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
      return false;
    }
  }, [loadTemplates]);

  const deleteTemplate = useCallback(async (id: string) => {
    try {
      await mailService.deleteTemplate(id);
      await loadTemplates();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
      return false;
    }
  }, [loadTemplates]);

  return { templates, loading, error, loadTemplates, saveTemplate, deleteTemplate };
}
