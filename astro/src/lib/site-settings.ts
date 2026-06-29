import { getPocketBase } from './pocketbase';

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
  site_title: '胡巴的博客',
  site_description: '胡巴的个人博客，记录技术、思考与生活。',
  site_logo: '',
  posts_per_page: 10,
  enable_comments: true,
  comment_moderation: true,
  debug_protection_enabled: false,
};

type SettingRecord = {
  key: string;
  value: unknown;
};

const PUBLIC_SETTING_KEYS = Object.keys(DEFAULT_SITE_SETTINGS) as Array<keyof SiteSettings>;

function normalizeValue(key: keyof SiteSettings, value: unknown): SiteSettings[keyof SiteSettings] {
  const fallback = DEFAULT_SITE_SETTINGS[key];

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