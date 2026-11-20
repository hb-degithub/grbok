import { BaseService } from './baseService';
import type { RecordModel } from 'pocketbase';
import {
  DEFAULT_SITE_SETTINGS_SCALARS,
  SITE_SETTING_SCALAR_KEYS,
  type SiteSettingsScalars,
} from '../../lib/settings-defaults';

export interface SettingRecord {
  id: string;
  key: string;
  value: string;
  description?: string;
  created: string;
  updated: string;
}

type SettingRecordModel = SettingRecord & RecordModel;

// 后台只关心 7 个标量键；feature_flags 只在公开 site-settings 里合并。
// 类型与默认值都来自 lib/settings-defaults.ts，避免前后台出现两套标题/描述。
export type SiteSettings = SiteSettingsScalars;

export const DEFAULT_SITE_SETTINGS: SiteSettings = { ...DEFAULT_SITE_SETTINGS_SCALARS };

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

    // 只遍历共享的 7 个标量键：调用方即使传入公开站点设置对象（含 feature_flags），
    // 也不会把对象写进 settings 表；保存键集合与 getAllSettings 的返回保持一致。
    for (const key of SITE_SETTING_SCALAR_KEYS) {
      const value = settings[key];
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