import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * AI 设置面板 · 配置校验失败可定位 + 运行诊断。
 *
 * 保存失败时后端会回 data.field，面板必须：
 * - 显示「配置校验失败：字段（人话原因）」而不是笼统文案；
 * - 高亮对应输入框（aria-invalid + 危险色描边）。
 * 「运行诊断」把 errors、origin_allowed、has_key 一次展示出来。
 */

const serviceMocks = vi.hoisted(() => ({
  getAiSettings: vi.fn(),
  saveAiSettings: vi.fn(),
  diagnoseAiSettings: vi.fn(),
  testAiConnection: vi.fn(),
}));

vi.mock('../../../lib/services/aiSettingsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/services/aiSettingsService')>();
  return { ...actual, ...serviceMocks };
});

import AiSettingsPanel from '../AiSettingsPanel';

const SETTINGS = {
  configured: true,
  enabled: true,
  base_url: 'https://api.example.com/v1',
  model: 'deepseek-chat',
  timeout_seconds: 60,
  article_publish_mode: 'draft' as const,
  comment_mode: 'assist' as const,
  banned_words_enabled: false,
  banned_words: [],
  reply_name: 'AI 助手',
  reply_persona: '',
  has_key: true,
  updated_at: '2026-11-22 10:00:00.000Z',
};

function invalidConfigError(field: string, message = `INVALID_AI_CONFIG: ${field}`) {
  return {
    status: 400,
    message,
    response: { data: { code: 'INVALID_AI_CONFIG', field, message } },
  };
}

beforeEach(() => {
  serviceMocks.getAiSettings.mockReset();
  serviceMocks.saveAiSettings.mockReset();
  serviceMocks.diagnoseAiSettings.mockReset();
  serviceMocks.testAiConnection.mockReset();
  serviceMocks.getAiSettings.mockResolvedValue(SETTINGS);
});

afterEach(cleanup);

describe('AiSettingsPanel · 字段级校验失败', () => {
  it('保存失败时显示「配置校验失败：字段（原因）」并高亮对应输入框', async () => {
    serviceMocks.saveAiSettings.mockRejectedValue(invalidConfigError('base_url'));
    render(<AiSettingsPanel />);

    fireEvent.click(await screen.findByRole('button', { name: '保存设置' }));

    await waitFor(() => expect(screen.getByText(/配置校验失败：接口地址/)).toBeTruthy());
    const baseUrl = screen.getByLabelText('接口地址（base_url）') as HTMLInputElement;
    expect(baseUrl.getAttribute('aria-invalid')).toBe('true');
    expect(baseUrl.className).toContain('border-[var(--sf-danger)]');

    // 其他字段不能被误标
    const model = screen.getByLabelText('模型名称') as HTMLInputElement;
    expect(model.getAttribute('aria-invalid')).toBeNull();
  });

  it('旧后端只在 message 里带字段名时也能定位（兜底解析）', async () => {
    serviceMocks.saveAiSettings.mockRejectedValue(new Error('INVALID_AI_CONFIG: model'));
    render(<AiSettingsPanel />);

    fireEvent.click(await screen.findByRole('button', { name: '保存设置' }));

    await waitFor(() => expect(screen.getByText(/配置校验失败：模型名称/)).toBeTruthy());
    expect((screen.getByLabelText('模型名称') as HTMLInputElement).getAttribute('aria-invalid')).toBe('true');
  });

  it('非字段校验错误仍走通用错误文案', async () => {
    serviceMocks.saveAiSettings.mockRejectedValue(new Error('AI_TIMEOUT: 上游响应超时'));
    render(<AiSettingsPanel />);

    fireEvent.click(await screen.findByRole('button', { name: '保存设置' }));

    await waitFor(() => expect(screen.getByText('上游响应超时')).toBeTruthy());
    expect(screen.queryByText(/配置校验失败/)).toBeNull();
  });
});

describe('AiSettingsPanel · 运行诊断', () => {
  it('展示 errors 列表与白名单/密钥状态', async () => {
    serviceMocks.diagnoseAiSettings.mockResolvedValue({
      ok: false,
      errors: [{ field: 'base_url', reason: 'origin 未在 AI_ALLOWED_ORIGINS 白名单内' }],
      effective: {
        base_url: 'https://api.example.com/v1',
        origin_allowed: false,
        model: 'deepseek-chat',
        has_key: false,
        enabled: true,
      },
    });
    render(<AiSettingsPanel />);

    fireEvent.click(await screen.findByRole('button', { name: '运行诊断' }));

    expect(await screen.findByText('配置检查未通过（1）')).toBeTruthy();
    expect(screen.getByText('来源白名单：不允许')).toBeTruthy();
    expect(screen.getByText('API Key：缺失')).toBeTruthy();
    expect(screen.getByText('origin 未在 AI_ALLOWED_ORIGINS 白名单内')).toBeTruthy();
    expect(screen.getByText(/不在服务端白名单 AI_ALLOWED_ORIGINS 内/)).toBeTruthy();
    expect(screen.getByText('https://api.example.com/v1')).toBeTruthy();
  });

  it('诊断通过时显示「配置检查通过」与就绪状态', async () => {
    serviceMocks.diagnoseAiSettings.mockResolvedValue({
      ok: true,
      errors: [],
      effective: {
        base_url: 'https://api.example.com/v1',
        origin_allowed: true,
        model: 'deepseek-chat',
        has_key: true,
        enabled: true,
      },
    });
    render(<AiSettingsPanel />);

    fireEvent.click(await screen.findByRole('button', { name: '运行诊断' }));

    expect(await screen.findByText('配置检查通过')).toBeTruthy();
    expect(screen.getByText('来源白名单：允许')).toBeTruthy();
    expect(screen.getByText('API Key：已就绪')).toBeTruthy();
    expect(screen.queryByText(/不在服务端白名单/)).toBeNull();
  });

  it('诊断失败时显示可读错误，不把旧结论当真', async () => {
    serviceMocks.diagnoseAiSettings.mockRejectedValue(new Error('AI_RATE_LIMITED'));
    render(<AiSettingsPanel />);

    fireEvent.click(await screen.findByRole('button', { name: '运行诊断' }));

    await waitFor(() => expect(screen.getByText('操作过于频繁，请稍后重试')).toBeTruthy());
  });
});
