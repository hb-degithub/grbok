import { describe, expect, it } from 'vitest';
import { DEFAULT_SITE_SETTINGS, mergeSettingRecords } from '../site-settings';
import { DEFAULT_FEATURE_FLAGS } from '../../config/feature-flags';
import {
  DEFAULT_SITE_SETTINGS_SCALARS,
  SITE_SETTING_SCALAR_KEYS,
} from '../settings-defaults';

/**
 * 前台设置合流契约：
 * - 7 个标量默认值来自 lib/settings-defaults.ts（与后台共用，公开品牌文案）；
 * - feature_flags 只在公开 site-settings 里合并，缺失/损坏时回退默认值；
 * - 未知 key 不会写进结果。
 */
describe('site-settings · 标量默认值与 feature_flags', () => {
  it('7 个标量默认值与共享默认值一致，并使用公开品牌文案', () => {
    for (const key of SITE_SETTING_SCALAR_KEYS) {
      expect(DEFAULT_SITE_SETTINGS[key]).toEqual(DEFAULT_SITE_SETTINGS_SCALARS[key]);
    }
    expect(DEFAULT_SITE_SETTINGS.site_title).toBe('胡巴的博客');
    expect(DEFAULT_SITE_SETTINGS.site_description).toBe('胡巴的个人博客，记录技术、思考与生活。');
  });

  it('feature_flags 只在公开 site-settings 出现，缺失时回退默认值', () => {
    expect(DEFAULT_SITE_SETTINGS.feature_flags).toEqual(DEFAULT_FEATURE_FLAGS);

    const merged = mergeSettingRecords([]);
    expect(merged.feature_flags).toEqual(DEFAULT_FEATURE_FLAGS);
    expect(Object.keys(merged).sort()).toEqual(
      [...SITE_SETTING_SCALAR_KEYS, 'feature_flags'].sort(),
    );
  });

  it('合并记录时标量覆盖生效，feature_flags 与默认值浅合并', () => {
    const merged = mergeSettingRecords([
      { key: 'site_title', value: '线上标题' },
      { key: 'posts_per_page', value: '7' },
      { key: 'enable_comments', value: 'false' },
      {
        key: 'feature_flags',
        value: JSON.stringify({ newsletter: { enabled: true, frequency: 'monthly' } }),
      },
    ]);

    expect(merged.site_title).toBe('线上标题');
    expect(merged.posts_per_page).toBe(7);
    expect(merged.enable_comments).toBe(false);
    expect(merged.feature_flags.newsletter).toEqual({ enabled: true, frequency: 'monthly' });
    // 未覆盖的 flag 分组仍保留默认值。
    expect(merged.feature_flags.rag_chatbot).toEqual(DEFAULT_FEATURE_FLAGS.rag_chatbot);
    expect(merged.feature_flags.privacy_analytics).toEqual(DEFAULT_FEATURE_FLAGS.privacy_analytics);
  });

  it('feature_flags 存储值损坏时回退默认值，不影响其他标量', () => {
    const merged = mergeSettingRecords([
      { key: 'feature_flags', value: '{not-json' },
      { key: 'site_title', value: '线上标题' },
    ]);

    expect(merged.feature_flags).toEqual(DEFAULT_FEATURE_FLAGS);
    expect(merged.site_title).toBe('线上标题');
  });

  it('未知 key 被忽略，不会污染设置对象', () => {
    const merged = mergeSettingRecords([{ key: 'unknown_setting', value: 'x' }]);

    expect(merged).toEqual(DEFAULT_SITE_SETTINGS);
    expect(merged).not.toHaveProperty('unknown_setting');
  });
});
