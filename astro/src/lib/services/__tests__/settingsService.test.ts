import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SITE_SETTINGS,
  settingsService,
  type SettingRecord,
} from '../settingsService';
import { DEFAULT_SITE_SETTINGS as PUBLIC_DEFAULT_SITE_SETTINGS } from '../../site-settings';
import { DEFAULT_SITE_SETTINGS_SCALARS, SITE_SETTING_SCALAR_KEYS } from '../../settings-defaults';

/**
 * Task A 行为契约：设置加载失败必须向上抛出。
 *
 * 历史问题：getAllSettings 内部 catch 后返回 DEFAULT_SITE_SETTINGS，
 * 调用方（后台设置页）无法区分「真实设置」与「默认值」，
 * 用户一旦点击保存就会用默认值覆盖线上配置。
 * 这里锁定：签名不变（Promise<SiteSettings>），成功仍然合并默认值，失败只抛异常。
 */
const record = (key: string, value: string, id = `s_${key}`): SettingRecord => ({
  id,
  key,
  value,
  created: '',
  updated: '',
});

const mockFullList = (value: Promise<SettingRecord[]>) =>
  vi.spyOn(settingsService, 'getFullList').mockResolvedValue(value as never);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('settingsService.getAllSettings', () => {
  it('成功时返回「默认值 + 记录值」的合并结果', async () => {
    mockFullList(
      Promise.resolve([
        record('site_title', '线上标题'),
        record('site_description', '线上描述'),
        record('posts_per_page', '25'),
        record('enable_comments', 'false'),
        record('comment_moderation', 'false'),
        record('debug_protection_enabled', 'true'),
      ]),
    );

    const result = await settingsService.getAllSettings();

    expect(result).toEqual({
      ...DEFAULT_SITE_SETTINGS,
      site_title: '线上标题',
      site_description: '线上描述',
      posts_per_page: 25,
      enable_comments: false,
      comment_moderation: false,
      debug_protection_enabled: true,
    });
  });

  it('加载失败时向上抛出，不返回默认值（避免默认值覆盖线上设置）', async () => {
    mockFullList(Promise.reject(new Error('网络异常')));

    const outcome = await settingsService.getAllSettings().then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? null : String(outcome.error)).toContain('网络异常');
  });

  it('签名保持 Promise<SiteSettings>（返回值不再因失败变成兜底对象）', async () => {
    mockFullList(Promise.reject({ status: 500, message: '服务器错误' }));

    await expect(settingsService.getAllSettings()).rejects.toMatchObject({ status: 500 });
  });
});

describe('settingsService 默认值与公开 site-settings 合流', () => {
  it('后台 7 个标量默认值与公开站点完全相同（单一来源 lib/settings-defaults）', () => {
    expect(Object.keys(DEFAULT_SITE_SETTINGS).sort()).toEqual([...SITE_SETTING_SCALAR_KEYS].sort());
    expect(Object.keys(PUBLIC_DEFAULT_SITE_SETTINGS).sort()).toEqual(
      [...SITE_SETTING_SCALAR_KEYS, 'feature_flags'].sort(),
    );
    expect(DEFAULT_SITE_SETTINGS).toEqual(DEFAULT_SITE_SETTINGS_SCALARS);

    for (const key of SITE_SETTING_SCALAR_KEYS) {
      expect(PUBLIC_DEFAULT_SITE_SETTINGS[key]).toEqual(DEFAULT_SITE_SETTINGS_SCALARS[key]);
    }
  });

  it('统一使用公开品牌文案，不再是「个人博客 / 分享技术与生活」', () => {
    expect(DEFAULT_SITE_SETTINGS.site_title).toBe('胡巴的博客');
    expect(DEFAULT_SITE_SETTINGS.site_description).toBe('胡巴的个人博客，记录技术、思考与生活。');
  });

  it('后台不含 feature_flags：保存只写 7 个标量键（即使调用方误传公开设置对象）', async () => {
    const createdKeys: string[] = [];

    vi.spyOn(settingsService, 'getPocketBase').mockReturnValue({
      filter: (filter: string) => filter,
      collection: () => ({
        getFirstListItem: async () => {
          throw { status: 404 };
        },
      }),
    } as never);
    vi.spyOn(settingsService, 'create').mockImplementation(async (data) => {
      createdKeys.push(data.key as string);
      return data as never;
    });

    const publicStyleSettings = {
      ...DEFAULT_SITE_SETTINGS,
      feature_flags: { newsletter: { enabled: true } },
    };

    await settingsService.saveSettings(publicStyleSettings);

    expect(createdKeys).toEqual([...SITE_SETTING_SCALAR_KEYS]);
    expect(createdKeys).not.toContain('feature_flags');
  });
});
