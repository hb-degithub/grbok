import { getPocketBase } from './pocketbase';
import { DEFAULT_FEATURE_FLAGS, type FeatureFlags } from '../config/feature-flags';
import {
  DEFAULT_SITE_SETTINGS_SCALARS,
  type SiteSettingsScalars,
} from './settings-defaults';

// 前台设置 = 与后台共用的 7 个标量默认值 + 公开页需要的 feature_flags。
// feature_flags 是对象且只在公开 site-settings 里合并，后台不感知它。
export interface SiteSettings extends SiteSettingsScalars {
  feature_flags: FeatureFlags;
}

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  ...DEFAULT_SITE_SETTINGS_SCALARS,
  feature_flags: DEFAULT_FEATURE_FLAGS,
};

type SettingRecord = {
  key: string;
  value: unknown;
};

function normalizeValue(key: keyof SiteSettings, value: unknown): SiteSettings[keyof SiteSettings] {
  const fallback = DEFAULT_SITE_SETTINGS[key];

  // feature_flags 是对象类型，直接合并默认值
  if (key === 'feature_flags') {
    const stored = value as Partial<FeatureFlags> | string;
    let parsed: Partial<FeatureFlags>;
    if (typeof stored === 'string') {
      try { parsed = JSON.parse(stored || '{}'); }
      catch { return DEFAULT_FEATURE_FLAGS; }
    } else {
      parsed = stored || {};
    }
    return { ...DEFAULT_FEATURE_FLAGS, ...parsed };
  }

  if (typeof fallback === 'boolean') {
    return value === true || value === 'true';
  }

  if (typeof fallback === 'number') {
    const numberValue = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : fallback;
  }

  return typeof value === 'string' ? value : String(value ?? fallback);
}

export function mergeSettingRecords(records: SettingRecord[]): SiteSettings {
  const settings = { ...DEFAULT_SITE_SETTINGS };

  for (const record of records) {
    if (record.key in settings) {
      const key = record.key as keyof SiteSettings;
      (settings as unknown as Record<keyof SiteSettings, SiteSettings[keyof SiteSettings]>)[key] = normalizeValue(key, record.value);
    }
  }

  return settings;
}

export async function loadSiteSettings(): Promise<SiteSettings> {
  const pb = getPocketBase();
  // 2026-11-16：不再下发 "key = ... || key = ..." 的长 OR filter。
  // settings 集合的 listRule 已经把匿名可读范围限定为上面的 8 个公开键
  // （7 个标量 + feature_flags），
  // 该 filter 完全冗余；而 SafeLine 会把带引号与 || 的 filter 判成注入并返回挑战页（浏览器 403），
  // 导致每一页的站点设置加载失败（评论开关等全部回退默认值）。
  // 这里改为不带 filter 的整表读取，服务端规则保证只返回允许的键。
  const records = await pb.collection('settings').getFullList<SettingRecord>({
    fields: 'key,value',
  });

  return mergeSettingRecords(records);
}