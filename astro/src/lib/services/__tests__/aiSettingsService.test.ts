import { describe, expect, it, vi } from 'vitest';

/**
 * AI 配置字段级错误与诊断接口的纯函数契约。
 *
 * 新后端：INVALID_AI_CONFIG 响应 data = { code: 'INVALID_AI_CONFIG', field: 'base_url' }；
 * 滚动发布期旧后端只在 message 里写 `INVALID_AI_CONFIG: base_url`，两种都要能定位到字段。
 */

const { pbState } = vi.hoisted(() => ({
  pbState: { client: null as unknown },
}));

vi.mock('../../pocketbase', () => ({
  getPocketBase: () => pbState.client,
}));

import {
  aiConfigField,
  describeAiConfigFieldError,
  diagnoseAiSettings,
  normalizeDiagnostics,
} from '../aiSettingsService';

describe('aiConfigField', () => {
  it('优先读取响应 data.field', () => {
    expect(aiConfigField({ response: { data: { code: 'INVALID_AI_CONFIG', field: 'model' } } })).toBe('model');
  });

  it('旧后端 message 前缀兜底：INVALID_AI_CONFIG: base_url', () => {
    expect(aiConfigField(new Error('INVALID_AI_CONFIG: base_url'))).toBe('base_url');
    expect(aiConfigField({ response: { data: { message: 'INVALID_AI_CONFIG: api_key' } } })).toBe('api_key');
  });

  it('未知字段与非校验错误返回空串', () => {
    expect(aiConfigField({ response: { data: { field: 'unknown_field' } } })).toBe('');
    expect(aiConfigField({ response: { data: { field: 'x', code: 'AI_TIMEOUT' } } })).toBe('');
    expect(aiConfigField(null)).toBe('');
  });
});

describe('describeAiConfigFieldError', () => {
  it('生成「配置校验失败：字段（人话原因）」并携带字段名', () => {
    const issue = describeAiConfigFieldError({ response: { data: { code: 'INVALID_AI_CONFIG', field: 'base_url' } } });

    expect(issue).not.toBeNull();
    expect(issue?.field).toBe('base_url');
    expect(issue?.label).toBe('接口地址');
    expect(issue?.message).toContain('配置校验失败：接口地址');
    expect(issue?.reason).toContain('http(s)');
  });

  it('后端额外给出 reason 时优先使用', () => {
    const issue = describeAiConfigFieldError({
      response: { data: { code: 'INVALID_AI_CONFIG', field: 'banned_words', reason: '单条违禁词过长' } },
    });

    expect(issue?.reason).toBe('单条违禁词过长');
    expect(issue?.message).toBe('配置校验失败：违禁词表（单条违禁词过长）');
  });

  it('没有字段信息时返回 null（调用方退回通用文案）', () => {
    expect(describeAiConfigFieldError(new Error('网络异常'))).toBeNull();
  });
});

describe('normalizeDiagnostics', () => {
  it('完整响应原样归一化', () => {
    const normalized = normalizeDiagnostics({
      ok: false,
      errors: [{ field: 'base_url', reason: '不在白名单' }],
      effective: { base_url: 'https://ai.example.com/v1', origin_allowed: false, model: 'deepseek-chat', has_key: true, enabled: true },
    });

    expect(normalized.ok).toBe(false);
    expect(normalized.errors).toEqual([{ field: 'base_url', reason: '不在白名单' }]);
    expect(normalized.effective.origin_allowed).toBe(false);
    expect(normalized.effective.has_key).toBe(true);
  });

  it('字段缺失时按保守值兜底，不抛错', () => {
    const normalized = normalizeDiagnostics({});

    expect(normalized.ok).toBe(false);
    expect(normalized.errors).toEqual([]);
    expect(normalized.effective).toEqual({
      base_url: '',
      origin_allowed: false,
      model: '',
      has_key: false,
      enabled: false,
    });
  });

  it('ok=true 但有 errors 时判定为未通过', () => {
    expect(normalizeDiagnostics({ ok: true, errors: [{ field: 'model', reason: '为空' }] }).ok).toBe(false);
    expect(normalizeDiagnostics({ ok: true, errors: [] }).ok).toBe(true);
  });
});

describe('diagnoseAiSettings', () => {
  it('GET /api/blog-admin/ai/diagnostics 并归一化响应', async () => {
    const send = vi.fn().mockResolvedValue({
      ok: true,
      errors: [],
      effective: { base_url: 'https://ai.example.com/v1', origin_allowed: true, model: 'deepseek-chat', has_key: true, enabled: true },
    });
    pbState.client = { send };

    const result = await diagnoseAiSettings();

    expect(send).toHaveBeenCalledWith('/api/blog-admin/ai/diagnostics', { method: 'GET' });
    expect(result.ok).toBe(true);
    expect(result.effective.origin_allowed).toBe(true);
  });
});
