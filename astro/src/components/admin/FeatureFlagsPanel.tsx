import React, { useState, useEffect, useCallback } from 'react';
import { getPocketBase } from '../../lib/pocketbase';
import { DEFAULT_FEATURE_FLAGS, FEATURE_FLAGS_KEY, type FeatureFlags } from '../../config/feature-flags';
import { showToast } from '../ui/Toast';

/**
 * 智能功能开关面板 —— 超管后台新增模块。
 *
 * 路由：/admin/features/
 * 权限：admin+
 * 依赖文件：config/feature-flags.ts, lib/pocketbase.ts, hooks/useSiteSettings.ts
 * 资产保护：纯配置驱动，不修改任何前端 DOM/CSS/动画。
 *
 * 所有开关写入 settings 表 key="feature_flags"，
 * 前端组件通过 useSiteSettings 读取并决定是否渲染。
 */

type FlagSection = keyof FeatureFlags;

const SECTION_LABELS: Record<FlagSection, string> = {
  rag_chatbot: 'RAG 助手',
  privacy_analytics: '隐私埋点',
  newsletter: 'Newsletter',
  ab_testing: 'A/B 测试',
};

const SECTION_ICONS: Record<FlagSection, string> = {
  rag_chatbot: '💬',
  privacy_analytics: '📊',
  newsletter: '📧',
  ab_testing: '🧪',
};

export default function FeatureFlagsPanel() {
  const [flags, setFlags] = useState<FeatureFlags>(DEFAULT_FEATURE_FLAGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // showToast is imported as a module-level function

  const pb = getPocketBase();

  const loadFlags = useCallback(async () => {
    try {
      const record = await pb.collection('settings').getFirstListItem(
        pb.filter('key = {:key}', { key: FEATURE_FLAGS_KEY })
      );
      // settings.value 是 json 字段，SDK 返回时已解析为对象，无需 JSON.parse
      const stored = record.value as Partial<FeatureFlags> | string;
      let parsed: Partial<FeatureFlags>;
      if (typeof stored === 'string') {
        try { parsed = JSON.parse(stored || '{}'); }
        catch { parsed = {}; }
      } else {
        parsed = stored || {};
      }
      setFlags({ ...DEFAULT_FEATURE_FLAGS, ...parsed });
    } catch {
      // 首次使用，记录不存在，用默认值
      setFlags(DEFAULT_FEATURE_FLAGS);
    } finally {
      setLoading(false);
    }
  }, [pb]);

  useEffect(() => {
    loadFlags();
  }, [loadFlags]);

  const saveFlags = async () => {
    setSaving(true);
    try {
      // settings.value 是 json 字段，PocketBase 期望直接传对象而非字符串
      const payload = { value: flags, description: '智能功能开关配置' };
      try {
        const existing = await pb.collection('settings').getFirstListItem(
          pb.filter('key = {:key}', { key: FEATURE_FLAGS_KEY })
        );
        await pb.collection('settings').update(existing.id, payload);
      } catch (notFoundErr) {
        // 记录不存在，创建
        await pb.collection('settings').create({ key: FEATURE_FLAGS_KEY, ...payload });
      }
      showToast('功能开关已保存', 'success');
    } catch (err) {
      showToast('保存失败，请检查权限', 'error');
      console.error('Feature flags save error:', err);
    } finally {
      setSaving(false);
    }
  };

  const toggleFlag = (section: FlagSection) => {
    setFlags((prev) => ({
      ...prev,
      [section]: { ...prev[section], enabled: !prev[section].enabled },
    }));
  };

  const updateFlag = <K extends FlagSection>(section: K, field: string, value: unknown) => {
    setFlags((prev) => ({
      ...prev,
      [section]: { ...prev[section], [field]: value },
    }));
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="animate-pulse rounded-xl border border-border bg-white p-6 dark:bg-zinc-900">
            <div className="h-6 w-40 rounded bg-zinc-200 dark:bg-zinc-700" />
            <div className="mt-4 h-4 w-full rounded bg-zinc-100 dark:bg-zinc-800" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-zinc-950 dark:text-zinc-50">智能功能开关</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            控制博客智能化功能的启停与参数。所有开关通过配置驱动前端，无需修改代码。
          </p>
        </div>
        <button
          onClick={saveFlags}
          disabled={saving}
          className="inline-flex min-h-10 items-center rounded-lg bg-teal-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-teal-700 disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存配置'}
        </button>
      </div>

      {(Object.keys(flags) as FlagSection[]).map((section) => {
        const config = flags[section];
        return (
          <section
            key={section}
            className="rounded-xl border border-border bg-white p-6 shadow-sm dark:bg-zinc-900"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <span className="text-2xl" aria-hidden="true">{SECTION_ICONS[section]}</span>
                <div>
                  <h3 className="text-base font-semibold text-zinc-950 dark:text-zinc-50">
                    {SECTION_LABELS[section]}
                  </h3>
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    {section === 'rag_chatbot' && '悬浮 Chatbot Widget，API 失败时降级为静态 FAQ'}
                    {section === 'privacy_analytics' && '无 Cookie 隐私埋点，尊重 DNT，sendBeacon 上报'}
                    {section === 'newsletter' && '订阅表单与邮件频率控制'}
                    {section === 'ab_testing' && '客户端特征标志，实验变体动态渲染'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={config.enabled}
                aria-label={`启用 ${SECTION_LABELS[section]}`}
                onClick={() => toggleFlag(section)}
                className={`relative h-7 w-12 rounded-full transition-colors ${
                  config.enabled ? 'bg-teal-600' : 'bg-zinc-300 dark:bg-zinc-700'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
                    config.enabled ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>

            {config.enabled && (
              <div className="mt-4 space-y-3 border-t border-border pt-4">
                {section === 'rag_chatbot' && (
                  <>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">API 端点</label>
                      <input
                        type="text"
                        value={config.endpoint}
                        onChange={(e) => updateFlag(section, 'endpoint', e.target.value)}
                        className="min-h-9 w-full rounded-md border border-border bg-white px-3 py-1.5 text-sm text-text outline-none focus:border-teal-400 dark:bg-zinc-800"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">FAQ（JSON 数组）</label>
                      <textarea
                        value={config.faqs_json}
                        onChange={(e) => updateFlag(section, 'faqs_json', e.target.value)}
                        rows={3}
                        className="w-full rounded-md border border-border bg-white px-3 py-1.5 text-sm text-text outline-none focus:border-teal-400 dark:bg-zinc-800"
                        placeholder='[{"q":"如何订阅？","a":"访问 /subscribe"}]'
                      />
                    </div>
                  </>
                )}
                {section === 'privacy_analytics' && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      事件采样率：{config.sample_rate * 100}%
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={config.sample_rate}
                      onChange={(e) => updateFlag(section, 'sample_rate', parseFloat(e.target.value))}
                      className="w-full"
                      aria-label="采样率"
                    />
                  </div>
                )}
                {section === 'newsletter' && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">发送频率</label>
                    <select
                      value={config.frequency}
                      onChange={(e) => updateFlag(section, 'frequency', e.target.value)}
                      className="min-h-9 w-full rounded-md border border-border bg-white px-3 py-1.5 text-sm text-text outline-none dark:bg-zinc-800"
                    >
                      <option value="weekly">每周</option>
                      <option value="biweekly">双周</option>
                      <option value="monthly">每月</option>
                    </select>
                  </div>
                )}
                {section === 'ab_testing' && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">活跃实验 ID（逗号分隔）</label>
                    <input
                      type="text"
                      value={config.active_experiments.join(', ')}
                      onChange={(e) => updateFlag(section, 'active_experiments', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
                      className="min-h-9 w-full rounded-md border border-border bg-white px-3 py-1.5 text-sm text-text outline-none dark:bg-zinc-800"
                      placeholder="hero-layout-v2, cta-color-test"
                    />
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}

      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/30">
        <p className="text-xs text-blue-700 dark:text-blue-300">
          ℹ️ 功能开关通过 PocketBase <code className="font-mono">settings</code> 表存储（key=<code className="font-mono">feature_flags</code>）。
          前端组件通过 <code className="font-mono">useSiteSettings</code> hook 读取配置，决定是否渲染对应功能。
          所有配置变更会记录到审计日志。
        </p>
      </div>
    </div>
  );
}
