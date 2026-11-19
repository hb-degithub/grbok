import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SITE_SETTINGS,
  settingsService,
  type SettingRecord,
} from '../settingsService';

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
