import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import SettingsForm from '../SettingsForm';
import {
  DEFAULT_SITE_SETTINGS,
  settingsService,
  type SiteSettings,
} from '../../../lib/services/settingsService';

/**
 * Task A 行为契约：设置页加载失败时显示 alert + 重试，
 * 且绝不把默认值渲染成可保存的表单（否则保存会用默认值覆盖线上配置）。
 */

const loadedSettings: SiteSettings = {
  ...DEFAULT_SITE_SETTINGS,
  site_title: '线上标题',
  posts_per_page: 7,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SettingsForm · 加载失败', () => {
  it('显示 alert 与重试按钮，且不渲染可保存的默认值表单', async () => {
    vi.spyOn(settingsService, 'getAllSettings').mockRejectedValue(new Error('加载失败：网络异常'));

    render(<SettingsForm />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('加载失败：网络异常');

    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '保存设置' })).toBeNull();
    expect(screen.queryByLabelText('站点标题')).toBeNull();
    expect(screen.queryByLabelText('每页文章数')).toBeNull();
  });

  it('重试成功后清除 alert 并载入真实设置', async () => {
    const getSpy = vi
      .spyOn(settingsService, 'getAllSettings')
      .mockRejectedValueOnce(new Error('加载失败'))
      .mockResolvedValueOnce(loadedSettings);

    render(<SettingsForm />);
    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    const titleInput = (await screen.findByLabelText('站点标题')) as HTMLInputElement;
    expect(titleInput.value).toBe('线上标题');
    expect(getSpy).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('重试再次失败时 alert 保持可见', async () => {
    vi.spyOn(settingsService, 'getAllSettings').mockRejectedValue(new Error('仍然失败'));

    render(<SettingsForm />);
    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('仍然失败'));
    expect(screen.queryByRole('button', { name: '保存设置' })).toBeNull();
  });

  it('成功加载后保存仍然走真实 service', async () => {
    vi.spyOn(settingsService, 'getAllSettings').mockResolvedValue(loadedSettings);
    const saveSpy = vi.spyOn(settingsService, 'saveSettings').mockResolvedValue();

    render(<SettingsForm />);
    await screen.findByLabelText('站点标题');

    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));

    await waitFor(() => expect(saveSpy).toHaveBeenCalledWith(loadedSettings));
  });
});
