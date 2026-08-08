import { useState, useEffect, useCallback } from 'react';
import { mailService, type MailOverviewData, type MailQueueItem, type MailLogItem, type MailVerifyData, type TemplateItem, type MailRuleData, type MailSuppressItem, type SmtpConfigForm, type SmtpConfigView, type MailTestResult } from '../../lib/services/mailService';
import { describePbError } from '../../lib/pb-error';
import { notifyStepUpExpired } from '../../lib/step-up-recovery';

export type TabKey = 'overview' | 'queue' | 'logs' | 'templates' | 'rules' | 'suppress' | 'smtp' | 'verify';

interface MailMessage {
  id: string;
  to: string;
  subject: string;
  body: string;
  status: 'pending' | 'sent' | 'failed';
  created: string;
  updated: string;
}

/** 从异常中提取 PocketBase 错误码（用于 describePbError） */
function errorCode(err: unknown): string | undefined {
  return (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
}

export function useMailCenter() {
  const [tab, setTab] = useState<TabKey>('overview');
  const [overview, setOverview] = useState<MailOverviewData | null>(null);
  const [queueItems, setQueueItems] = useState<MailQueueItem[]>([]);
  const [queueStatus, setQueueStatus] = useState('');
  const [logItems, setLogItems] = useState<MailLogItem[]>([]);
  const [logResult, setLogResult] = useState('');
  const [verifyData, setVerifyData] = useState<MailVerifyData | null>(null);
  const [templateItems, setTemplateItems] = useState<TemplateItem[]>([]);
  const [ruleData, setRuleData] = useState<MailRuleData | null>(null);
  const [suppressItems, setSuppressItems] = useState<MailSuppressItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await mailService.getMailOverview();
      setOverview(data);
    } catch (err: unknown) {
      if (notifyStepUpExpired(err)) { setError('管理会话已过期，请重新验证动态口令'); return; }
      setError(describePbError(err, errorCode(err) || '无法读取邮件概览'));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await mailService.getMailQueue(queueStatus);
      setQueueItems(data.items || []);
    } catch (err: unknown) {
      if (notifyStepUpExpired(err)) { setError('管理会话已过期，请重新验证动态口令'); return; }
      setError(describePbError(err, errorCode(err) || '无法读取邮件队列'));
    } finally {
      setLoading(false);
    }
  }, [queueStatus]);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await mailService.getMailLogs(logResult);
      setLogItems(data.items || []);
    } catch (err: unknown) {
      if (notifyStepUpExpired(err)) { setError('管理会话已过期，请重新验证动态口令'); return; }
      setError(describePbError(err, errorCode(err) || '无法读取邮件日志'));
    } finally {
      setLoading(false);
    }
  }, [logResult]);

  const runVerify = useCallback(async () => {
    setLoading(true);
    setError('');
    setStatus('');
    try {
      const data = await mailService.verifyMail();
      setVerifyData(data);
      setStatus(data.verified ? '连接验证成功' : '连接验证失败');
    } catch (err: unknown) {
      if (notifyStepUpExpired(err)) { setError('管理会话已过期，请重新验证动态口令'); return; }
      setError(describePbError(err, errorCode(err) || '验证请求失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await mailService.getMailTemplates();
      setTemplateItems(data.items || []);
    } catch (err: unknown) {
      if (notifyStepUpExpired(err)) { setError('管理会话已过期，请重新验证动态口令'); return; }
      setError(describePbError(err, errorCode(err) || '无法读取邮件模板'));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRules = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await mailService.getMailRules();
      setRuleData(data);
    } catch (err: unknown) {
      if (notifyStepUpExpired(err)) { setError('管理会话已过期，请重新验证动态口令'); return; }
      setError(describePbError(err, errorCode(err) || '无法读取邮件规则'));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSuppress = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await mailService.getMailSuppress();
      setSuppressItems(data.items || []);
    } catch (err: unknown) {
      if (notifyStepUpExpired(err)) { setError('管理会话已过期，请重新验证动态口令'); return; }
      setError(describePbError(err, errorCode(err) || '无法读取抑制列表'));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTabData = useCallback(async (target: TabKey) => {
    if (target === 'overview') await loadOverview();
    else if (target === 'queue') await loadQueue();
    else if (target === 'logs') await loadLogs();
    else if (target === 'templates') await loadTemplates();
    else if (target === 'rules') await loadRules();
    else if (target === 'suppress') await loadSuppress();
  }, [loadOverview, loadQueue, loadLogs, loadTemplates, loadRules, loadSuppress]);

  return {
    tab, setTab, overview, queueItems, queueStatus, setQueueStatus,
    logItems, logResult, setLogResult, verifyData, templateItems,
    ruleData, suppressItems, loading, error, status,
    runVerify, loadTabData, loadTemplates,
  };
}

const SMTP_DEFAULTS: SmtpConfigForm = {
  enabled: false,
  host: 'smtpdm.aliyun.com',
  port: 465,
  username: '',
  password: '',
  from_address: '',
  from_name: '个人博客',
  tls_mode: 'auto',
};

export function useSmtpConfig() {
  const [form, setForm] = useState<SmtpConfigForm>(SMTP_DEFAULTS);
  const [hasPassword, setHasPassword] = useState(false);
  const [updatedAt, setUpdatedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const data = await mailService.getSmtpConfigView();
      if (data.configured) {
        setForm({
          enabled: data.enabled,
          host: data.host || SMTP_DEFAULTS.host,
          port: data.port || 465,
          username: data.username || '',
          password: '',
          from_address: data.from_address || '',
          from_name: data.from_name || SMTP_DEFAULTS.from_name,
          tls_mode: data.tls_mode || 'auto',
        });
        setHasPassword(data.has_password);
        setUpdatedAt(data.updated_at || '');
      }
    } catch (err: unknown) {
      setMessage({ ok: false, text: `读取配置失败：${(err as Error)?.message || '未知错误'}` });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const patch = (key: string, value: string | number | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const save = async (thenVerify: boolean) => {
    setSaving(true);
    setMessage(null);
    try {
      const data: SmtpConfigView = await mailService.saveSmtpConfigView(form);
      setHasPassword(data.has_password);
      setUpdatedAt(data.updated_at || '');
      setForm((prev) => ({ ...prev, password: '' }));
      if (thenVerify) {
        setSaving(false);
        setVerifying(true);
        try {
          const result = await mailService.verifyMail();
          setMessage(result.verified
            ? { ok: true, text: '已保存，SMTP 连接验证成功' }
            : { ok: false, text: `已保存，但连接验证失败：${result.error || '未知错误'}` });
        } finally {
          setVerifying(false);
        }
        return;
      }
      setMessage({ ok: true, text: '已保存' });
    } catch (err: unknown) {
      if (notifyStepUpExpired(err)) { setMessage({ ok: false, text: '管理会话已过期，请重新验证动态口令' }); return; }
      setMessage({ ok: false, text: `保存失败：${describePbError(err, '未知错误')}` });
    } finally {
      setSaving(false);
    }
  };

  return { form, hasPassword, updatedAt, loading, saving, verifying, message, load, patch, save };
}

export interface TemplateEditForm {
  subject_template: string;
  preheader: string;
  title: string;
  paragraphs: string;
  footer: string;
  action_label: string;
}

const EMPTY_TEMPLATE_FORM: TemplateEditForm = {
  subject_template: '',
  preheader: '',
  title: '',
  paragraphs: '',
  footer: '',
  action_label: '',
};

export function useMailTemplate(item: TemplateItem, onSaved: () => void) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<TemplateEditForm>(EMPTY_TEMPLATE_FORM);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const hasAction = !!(item.content && item.content.action && typeof item.content.action === 'object');

  const startEdit = () => {
    setForm({
      subject_template: item.subject_template || '',
      preheader: item.content?.preheader || '',
      title: item.content?.title || '',
      paragraphs: (item.content?.paragraphs || []).join('\n'),
      footer: item.content?.footer || '',
      action_label: item.content?.action?.label || '',
    });
    setMessage(null);
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const paragraphs = form.paragraphs.split('\n').map((line) => line.trim()).filter(Boolean);
      await mailService.saveMailTemplate({
        key: item.key,
        subject_template: form.subject_template,
        preheader: form.preheader,
        title: form.title,
        paragraphs,
        footer: form.footer,
        action_label: form.action_label,
      });
      setMessage({ ok: true, text: '已保存' });
      setEditing(false);
      onSaved();
    } catch (err: unknown) {
      if (notifyStepUpExpired(err)) { setMessage({ ok: false, text: '管理会话已过期，请重新验证动态口令' }); return; }
      setMessage({ ok: false, text: `保存失败：${describePbError(err, '未知错误')}` });
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setMessage(null);
    try {
      const result: MailTestResult = await mailService.sendMailTest(item.key);
      setMessage(result.sent
        ? { ok: true, text: `测试邮件已发送至 ${result.to}（主题：${result.subject}），请查收。` }
        : { ok: false, text: `发送失败（${result.stage === 'render' ? '模板渲染' : 'SMTP 发送'}）：${result.error || '未知错误'}` });
    } catch (err: unknown) {
      setMessage({ ok: false, text: `发送失败：${(err as Error)?.message || '未知错误'}` });
    } finally {
      setTesting(false);
    }
  };

  return { editing, form, saving, testing, message, hasAction, startEdit, setEditing, setForm, save, runTest };
}

// 保留旧的简化 hook（其他调用方兼容）
export function useMailTemplateList() {
  const [templates, setTemplates] = useState<MailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const result = await mailService.getMailTemplates();
      setTemplates(result.items as unknown as MailMessage[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  return { templates, loading, error, loadTemplates };
}
