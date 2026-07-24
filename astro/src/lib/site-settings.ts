import { getPocketBase } from './pocketbase';
import { DEFAULT_FEATURE_FLAGS, type FeatureFlags } from '../config/feature-flags';

export interface SiteSettings {
  site_title: string;
  site_description: string;
  site_logo: string;
  posts_per_page: number;
  enable_comments: boolean;
  comment_moderation: boolean;
  debug_protection_enabled: boolean;
  feature_flags: FeatureFlags;
}

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  site_title: '胡巴的博客',
  site_description: '胡巴的个人博客，记录技术、思考与生活。',
  site_logo: '',
  posts_per_page: 10,
  enable_comments: true,
  comment_moderation: true,
  debug_protection_enabled: false,
  feature_flags: DEFAULT_FEATURE_FLAGS,
};

type SettingRecord = {
  key: string;
  value: unknown;
};

const PUBLIC_SETTING_KEYS = Object.keys(DEFAULT_SITE_SETTINGS) as Array<keyof SiteSettings>;

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
  const filter = PUBLIC_SETTING_KEYS.map((key) => pb.filter('key = {:key}', { key })).join(' || ');
  const records = await pb.collection('settings').getFullList<SettingRecord>({
    filter,
    fields: 'key,value',
  });

  return mergeSettingRecords(records);
}