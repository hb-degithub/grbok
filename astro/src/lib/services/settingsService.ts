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

  /**
   * 加载全部站点设置。
   *
   * 失败时必须向上抛出：调用方（后台设置页）需要区分「真实设置」与「默认值」，
   * 否则会拿 DEFAULT_SITE_SETTINGS 渲染表单，用户一点保存就把默认值写回线上。
   * 签名/返回类型保持不变（Promise<SiteSettings>），成功路径仍然合并默认值。
   */
  async getAllSettings(): Promise<SiteSettings> {
    const result = await this.getFullList();
    return this.mergeSettings(result);
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
    const failed: string[] = [];
    
    for (const [key, value] of Object.entries(settings)) {
      try {
        let existing: SettingRecordModel | null = null;
        try {
          existing = await pb.collection('settings').getFirstListItem(
            pb.filter('key = {:key}', { key })
          );
        } catch (e) {
          // 仅"不存在"才走创建，其他错误（如权限）直接抛出
          if ((e as { status?: number })?.status !== 404) throw e;
        }
        
        if (existing) {
          await this.update(existing.id, { value: String(value) });
        } else {
          await this.create({ key, value: String(value) });
        }
      } catch {
        failed.push(key);
      }
    }
    
    if (failed.length > 0) {
      throw new Error(`以下设置保存失败：${failed.join('、')}`);
    }
  }
}

export const settingsService = new SettingsService();