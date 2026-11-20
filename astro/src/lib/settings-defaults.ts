/**
 * 站点设置（PocketBase `settings` 集合）的「7 个标量键」唯一默认值来源。
 *
 * 背景：前台 `lib/site-settings.ts` 与后台 `lib/services/settingsService.ts`
 * 各自维护过一份默认值，后台那份还是旧品牌「个人博客 / 分享技术与生活」，
 * 导致设置页在字段缺失时展示的标题与线上站点不一致。
 *
 * 收敛范围只包含**标量默认值**：
 * - 前台 `DEFAULT_SITE_SETTINGS` = 本文件的 7 个标量 + `feature_flags`；
 * - 后台 `SiteSettings` 只有这 7 个键，`getAllSettings` 签名与 `saveSettings`
 *   写入的键集合保持不变。
 *
 * `feature_flags` 是对象且只在公开 `lib/site-settings.ts` 里合并，故意不放进本文件。
 */

/** 后台可编辑、前台可公开读取的标量键。顺序即后台保存顺序。 */
export const SITE_SETTING_SCALAR_KEYS = [
  'site_title',
  'site_description',
  'site_logo',
  'posts_per_page',
  'enable_comments',
  'comment_moderation',
  'debug_protection_enabled',
] as const;

export type SiteSettingScalarKey = (typeof SITE_SETTING_SCALAR_KEYS)[number];

export interface SiteSettingsScalars {
  site_title: string;
  site_description: string;
  site_logo: string;
  posts_per_page: number;
  enable_comments: boolean;
  comment_moderation: boolean;
  debug_protection_enabled: boolean;
}

/**
 * 与 `config/site.ts`、`feed.xml` 一致的公开品牌文案。
 * 改这里会同时影响前台回退值与后台设置页的初始值，因此只保留一份。
 */
export const DEFAULT_SITE_SETTINGS_SCALARS: Readonly<SiteSettingsScalars> = {
  site_title: '胡巴的博客',
  site_description: '胡巴的个人博客，记录技术、思考与生活。',
  site_logo: '',
  posts_per_page: 10,
  enable_comments: true,
  comment_moderation: true,
  debug_protection_enabled: false,
};

/** 判断任意字符串是否为受支持的标量设置键（用于过滤未知记录）。 */
export function isSiteSettingScalarKey(key: string): key is SiteSettingScalarKey {
  return (SITE_SETTING_SCALAR_KEYS as readonly string[]).includes(key);
}
