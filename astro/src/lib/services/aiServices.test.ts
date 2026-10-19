import { describe, expect, it } from 'vitest';
import { aiErrorCode } from './aiSettingsService';
import { describeAiError } from './aiAssistService';

// AI 路由错误码链路：后端 ApiError('AI_TIMEOUT: ...') → PB SDK ClientResponseError
// → 前端从 message 前缀提取稳定码并翻译为中文。回归该链路防止错误码漂移后用户看到裸英文码。
describe('aiErrorCode', () => {
  it('extracts stable code from response.data.code', () => {
    expect(aiErrorCode({ response: { data: { code: 'AI_RATE_LIMITED' } } })).toBe('AI_RATE_LIMITED');
  });
  it('extracts code prefix from response.data.message', () => {
    expect(aiErrorCode({ response: { data: { message: 'AI_TIMEOUT: 上游响应超时' } } })).toBe('AI_TIMEOUT');
  });
  it('extracts code prefix from plain error message', () => {
    expect(aiErrorCode(new Error('AI_NOT_CONFIGURED: 请先完成接入配置'))).toBe('AI_NOT_CONFIGURED');
  });
  it('returns empty string for non-AI errors', () => {
    expect(aiErrorCode(new Error('网络连接失败'))).toBe('');
    expect(aiErrorCode({ response: { data: { message: 'Bad request.' } } })).toBe('');
    expect(aiErrorCode(null)).toBe('');
    expect(aiErrorCode(undefined)).toBe('');
  });
});

describe('describeAiError', () => {
  it('maps known AI codes to Chinese copy', () => {
    expect(describeAiError(new Error('AI_TIMEOUT: 上游响应超时'), '兜底')).toContain('超时');
    expect(describeAiError(new Error('AI_AUTH_FAILED: x'), '兜底')).toContain('API Key');
    expect(describeAiError(new Error('AI_RATE_LIMITED'), '兜底')).toContain('频繁');
    expect(describeAiError(new Error('AI_NOT_CONFIGURED'), '兜底')).toContain('AI 设置');
  });
  it('falls back for non-AI errors', () => {
    const out = describeAiError(new Error('some plain failure'), '兜底文案');
    expect(out).not.toBe('some plain failure');
    expect(out.length).toBeGreaterThan(0);
  });
});
