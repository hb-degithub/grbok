import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../components/ui/Toast', () => ({ showToast: vi.fn() }));

import { showToast } from '../../../components/ui/Toast';
import {
  DEFAULT_SITE_SETTINGS,
  settingsService,
  type SiteSettings,
} from '../../../lib/services/settingsService';
import { useSettings } from '../useSettings';

/**
 * Task A 行为契约：设置加载失败要暴露 error 并允许重试；
 * 未成功加载前禁止保存，避免把默认值写回线上设置。
 */

const loadedSettings: SiteSettings = {
  ...DEFAULT_SITE_SETTINGS,
  site_title: '线上标题',
  posts_per_page: 7,
};

const mockedShowToast = vi.mocked(showToast);

beforeEach(() => {
  vi.spyOn(settingsService, 'saveSettings').mockResolvedValue();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('useSettings · 加载失败与重试', () => {
  it('加载失败时暴露 error，且不会静默回退成「已加载」状态', async () => {
    vi.spyOn(settingsService, 'getAllSettings').mockRejectedValue(new Error('网络异常'));

    const { result } = renderHook(() => useSettings());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('网络异常');
    expect(result.current.settings).toEqual(DEFAULT_SITE_SETTINGS);
  });

  it('加载失败后拒绝保存（不调用 saveSettings，并给出重试提示）', async () => {
    vi.spyOn(settingsService, 'getAllSettings').mockRejectedValue(new Error('网络异常'));
    const saveSpy = vi.mocked(settingsService.saveSettings);

    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.saveSettings();
    });

    expect(saveSpy).not.toHaveBeenCalled();
    expect(mockedShowToast).toHaveBeenCalledWith(expect.stringContaining('重试'), 'error');
  });

  it('重试成功后清除错误并载入真实设置', async () => {
    const getSpy = vi
      .spyOn(settingsService, 'getAllSettings')
      .mockRejectedValueOnce(new Error('加载失败'))
      .mockResolvedValueOnce(loadedSettings);

    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.error).toBe('加载失败'));

    await act(async () => {
      await result.current.retry();
    });

    expect(getSpy).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.settings).toEqual(loadedSettings);
  });

  it('重试再次失败时错误保持可见', async () => {
    vi.spyOn(settingsService, 'getAllSettings').mockRejectedValue(new Error('仍然失败'));

    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.error).toBe('仍然失败'));

    await act(async () => {
      await result.current.retry();
    });

    expect(result.current.error).toBe('仍然失败');
    expect(result.current.loading).toBe(false);
  });

  it('曾成功加载后重试再次失败，应重新禁止保存，直到下一次成功', async () => {
    vi.spyOn(settingsService, 'getAllSettings')
      .mockResolvedValueOnce(loadedSettings)
      .mockRejectedValueOnce(new Error('重试失败'))
      .mockResolvedValueOnce(loadedSettings);
    const saveSpy = vi.mocked(settingsService.saveSettings);

    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    // 曾经成功过，但重试失败必须退回「未加载」状态
    await act(async () => {
      await result.current.retry();
    });

    expect(result.current.loaded).toBe(false);
    expect(result.current.error).toBe('重试失败');

    await act(async () => {
      await result.current.saveSettings();
    });
    expect(saveSpy).not.toHaveBeenCalled();
    expect(mockedShowToast).toHaveBeenCalledWith(expect.stringContaining('重试'), 'error');

    // 只有再次成功加载后才恢复保存能力
    await act(async () => {
      await result.current.retry();
    });
    expect(result.current.loaded).toBe(true);
    expect(result.current.error).toBeNull();

    await act(async () => {
      await result.current.saveSettings();
    });
    expect(saveSpy).toHaveBeenCalledWith(loadedSettings);
  });

  it('成功加载后保存走真实 service', async () => {
    vi.spyOn(settingsService, 'getAllSettings').mockResolvedValue(loadedSettings);
    const saveSpy = vi.mocked(settingsService.saveSettings);

    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.saveSettings();
    });

    expect(saveSpy).toHaveBeenCalledWith(loadedSettings);
  });
});
