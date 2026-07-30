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
}

export const mailService = new MailService();
