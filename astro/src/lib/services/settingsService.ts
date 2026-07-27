import { BaseService } from './baseService';
import type { RecordModel } from 'pocketbase';

export interface SettingRecord {
  id: string;
  key: string;
  value: string;
  description?: string;
  created: string;
  updated: string;
}

type SettingRecordModel = SettingRecord & RecordModel;

export interface SiteSettings {
  site_title: string;
  site_description: string;
  site_logo: string;
  posts_per_page: number;
  enable_comments: boolean;
  comment_moderation: boolean;
  debug_protection_enabled: boolean;
}

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  site_title: '个人博客',
  site_description: '分享技术与生活',
  site_logo: '',
  posts_per_page: 10,
  enable_comments: true,
  comment_moderation: true,
  debug_protection_enabled: false,
};

class SettingsService extends BaseService<SettingRecordModel> {
  constructor() {
    super('settings');
  }

  async getAllSettings(): Promise<SiteSettings> {
    try {
      const result = await this.getFullList();
      return this.mergeSettings(result);
    } catch (err) {
      console.error('加载设置失败：', err);
      return DEFAULT_SITE_SETTINGS;
    }
  }

  private mergeSettings(records: SettingRecord[]): SiteSettings {
    const settings = { ...DEFAULT_SITE_SETTINGS };
    for (const record of records) {
      const key = record.key as keyof SiteSettings;
      if (key in settings) {
        const value = record.value;
        if (key === 'posts_per_page') {
          settings[key] = parseInt(value) || DEFAULT_SITE_SETTINGS[key];
        } else if (key === 'enable_comments' || key === 'comment_moderation' || key === 'debug_protection_enabled') {
          settings[key] = value === 'true';
        } else {
          settings[key] = value;
        }
      }
    }
    return settings;
  }

  async saveSettings(settings: SiteSettings): Promise<void> {
    const pb = this.getPocketBase();
    for (const [key, value] of Object.entries(settings)) {
      try {
        const existing = await pb.collection('settings').getFirstListItem(
          pb.filter('key = {:key}', { key })
        );
        await this.update(existing.id, { value: String(value) });
      } catch {
        await this.create({ key, value: String(value) });
      }
    }
  }
}

export const settingsService = new SettingsService();