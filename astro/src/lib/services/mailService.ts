import { BaseService } from './baseService';
import type { RecordModel } from 'pocketbase';

export interface MailMessage {
  id: string;
  to: string;
  subject: string;
  body: string;
  status: 'pending' | 'sent' | 'failed';
  created: string;
  updated: string;
}

export interface SmtpConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  from: string;
  enabled: boolean;
}

export interface MailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  created: string;
  updated: string;
}

type MailMessageRecord = MailMessage & RecordModel;
type MailTemplateRecord = MailTemplate & RecordModel;

// ---------- 邮件中心 /api/blog-admin/mail/* 接口的数据模型（由 admin-auth 网关提供） ----------

export interface MailOverviewData {
  gateway: {
    configured?: boolean;
    providerLabel?: string;
    port?: number;
    fromDomain?: string;
    tlsMode?: string;
    lastVerify?: string | null;
    checkedAt?: string;
    error?: string;
  } | null;
  summary: {
    sent_24h: number;
    failed_24h: number;
    success_rate: number;
    pending: number;
    processing: number;
    retry: number;
    failed_outbox: number;
  };
  checked_at: string;
}

export interface MailQueueItem {
  id: string;
  status: string;
  category: string;
  template_key: string;
  recipient_masked: string;
  attempt: number;
  next_attempt_at: string;
  last_error_class: string;
  created: string;
}

export interface MailLogItem {
  id: string;
  event_id: string;
  category: string;
  source_kind: string;
  result: string;
  duration_ms: number;
  attempt: number;
  error_class: string;
  archive_batch_id: string;
  created: string;
}

export interface MailVerifyData {
  verified: boolean;
  gateway: MailOverviewData['gateway'];
  error: string | null;
  checked_at: string;
}

export interface TemplateItem {
  id: string;
  key: string;
  name: string;
  category: string;
  version: number;
  is_current: boolean;
  builtin: boolean;
  subject_template: string;
  variables: string[];
  required_variables: string[];
  content?: {
    preheader?: string;
    title?: string;
    paragraphs?: string[];
    action?: { label?: string; urlVariable?: string } | null;
    footer?: string;
  };
}

export interface MailRulePolicy {
  key: string;
  limit: number;
  window_seconds: number;
  version: number;
}

export interface MailRuleData {
  policies: MailRulePolicy[];
  system_sources: { key: string; label: string; source: string; editable: boolean }[];
  note: string;
}

export interface MailSuppressItem {
  id: string;
  category: string;
  recipient_masked: string;
  last_error_class: string;
  created: string;
}

export interface SmtpConfigView {
  configured: boolean;
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  from_address: string;
  from_name: string;
  tls_mode: string;
  has_password: boolean;
  updated_at: string;
}

export interface SmtpConfigForm {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  password: string;
  from_address: string;
  from_name: string;
  tls_mode: string;
}

export interface MailTestResult {
  sent: boolean;
  to?: string;
  subject?: string;
  stage?: 'render' | 'smtp';
  error?: string;
}

class MailService extends BaseService<MailMessageRecord> {
  constructor() {
    super('mail_messages');
  }

  async getMessages(page = 1, perPage = 20): Promise<{ items: MailMessage[]; totalItems: number }> {
    const result = await this.getList(page, perPage, {
      sort: '-created',
    });
    return {
      items: result.items as unknown as MailMessage[],
      totalItems: result.totalItems,
    };
  }

  async sendMessage(data: { to: string; subject: string; body: string }): Promise<MailMessage> {
    const pb = this.getPocketBase();
    const record = await pb.collection('mail_messages').create({
      ...data,
      status: 'pending',
    });
    return record as unknown as MailMessage;
  }

  async retryMessage(id: string): Promise<void> {
    const pb = this.getPocketBase();
    await pb.collection('mail_messages').update(id, { status: 'pending' });
  }

  async deleteMessage(id: string): Promise<void> {
    await this.delete(id);
  }

  // SMTP Config
  async getSmtpConfig(): Promise<SmtpConfig | null> {
    const pb = this.getPocketBase();
    try {
      const record = await pb.collection('settings').getFirstListItem(
        pb.filter('key = {:key}', { key: 'smtp_config' })
      );
      const config = record.value as SmtpConfig;
      // 遮蔽密码，防止泄露到前端
      return {
        ...config,
        password: config.password ? '••••••••' : '',
      };
    } catch {
      return null;
    }
  }

  async saveSmtpConfig(config: SmtpConfig): Promise<void> {
    const pb = this.getPocketBase();
    try {
      const existing = await pb.collection('settings').getFirstListItem(
        pb.filter('key = {:key}', { key: 'smtp_config' })
      );
      // 如果密码是遮蔽值，保留原密码不更新
      const existingConfig = existing.value as SmtpConfig;
      const newConfig = {
        ...config,
        password: config.password === '••••••••' ? existingConfig.password : config.password,
      };
      await pb.collection('settings').update(existing.id, { value: newConfig });
    } catch {
      await pb.collection('settings').create({ key: 'smtp_config', value: config });
    }
  }

  // Mail Templates
  async getTemplates(): Promise<MailTemplate[]> {
    const pb = this.getPocketBase();
    const records = await pb.collection('mail_templates').getFullList({
      sort: 'name',
    });
    return records as unknown as MailTemplate[];
  }

  async getTemplate(id: string): Promise<MailTemplate | null> {
    const pb = this.getPocketBase();
    try {
      const record = await pb.collection('mail_templates').getOne(id);
      return record as unknown as MailTemplate;
    } catch {
      return null;
    }
  }

  async saveTemplate(data: Partial<MailTemplate> & { id?: string }): Promise<MailTemplate> {
    const pb = this.getPocketBase();
    if (data.id) {
      const record = await pb.collection('mail_templates').update(data.id, data);
      return record as unknown as MailTemplate;
    } else {
      const record = await pb.collection('mail_templates').create(data);
      return record as unknown as MailTemplate;
    }
  }

  async deleteTemplate(id: string): Promise<void> {
    const pb = this.getPocketBase();
    await pb.collection('mail_templates').delete(id);
  }

  // ---------- 邮件中心网关接口（admin-auth 提供） ----------

  async getMailOverview(): Promise<MailOverviewData> {
    return this.getPocketBase().send<MailOverviewData>('/api/blog-admin/mail/overview', { method: 'GET' });
  }

  async getMailQueue(status = ''): Promise<{ items: MailQueueItem[] }> {
    const params = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.getPocketBase().send<{ items: MailQueueItem[] }>(`/api/blog-admin/mail/queue${params}`, { method: 'GET' });
  }

  async getMailLogs(result = ''): Promise<{ items: MailLogItem[] }> {
    const params = result ? `?result=${encodeURIComponent(result)}` : '';
    return this.getPocketBase().send<{ items: MailLogItem[] }>(`/api/blog-admin/mail/logs${params}`, { method: 'GET' });
  }

  async verifyMail(): Promise<MailVerifyData> {
    return this.getPocketBase().send<MailVerifyData>('/api/blog-admin/mail/verify', { method: 'POST' });
  }

  async getMailTemplates(): Promise<{ items: TemplateItem[] }> {
    return this.getPocketBase().send<{ items: TemplateItem[] }>('/api/blog-admin/mail/templates', { method: 'GET' });
  }

  async getMailRules(): Promise<MailRuleData> {
    return this.getPocketBase().send<MailRuleData>('/api/blog-admin/mail/rules', { method: 'GET' });
  }

  async getMailSuppress(): Promise<{ items: MailSuppressItem[] }> {
    return this.getPocketBase().send<{ items: MailSuppressItem[] }>('/api/blog-admin/mail/suppress', { method: 'GET' });
  }

  async getSmtpConfigView(): Promise<SmtpConfigView> {
    return this.getPocketBase().send<SmtpConfigView>('/api/blog-admin/mail/smtp', { method: 'GET' });
  }

  async saveSmtpConfigView(form: SmtpConfigForm): Promise<SmtpConfigView> {
    return this.getPocketBase().send<SmtpConfigView>('/api/blog-admin/mail/smtp', { method: 'PUT', body: form });
  }

  async saveMailTemplate(payload: {
    key: string;
    subject_template: string;
    preheader: string;
    title: string;
    paragraphs: string[];
    footer: string;
    action_label: string;
  }): Promise<void> {
    await this.getPocketBase().send('/api/blog-admin/mail/templates', { method: 'PUT', body: payload });
  }

  async sendMailTest(key: string): Promise<MailTestResult> {
    return this.getPocketBase().send<MailTestResult>('/api/blog-admin/mail/test', { method: 'POST', body: { key } });
  }
}

export const mailService = new MailService();
