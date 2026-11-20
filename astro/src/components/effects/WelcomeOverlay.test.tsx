import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';

/**
 * WelcomeOverlay 回归（Task 5）。
 *
 * 这一轮把它收敛成「只在展示页出现的轻量单面板」，但认证调用不能变：
 * - `useUser().registerReader` / `requestVerification` 必须照旧被调用；
 * - 既有 `RateLimiter` 仍参与提交（测试只 mock 行为，不放宽限流配置）；
 * - 打开时焦点进入 dialog、Tab 在内部循环、Esc 关闭并归还焦点；
 * - 非展示页不渲染、不阻断正文。
 */

const { registerReader, requestVerification, tryConsume } = vi.hoisted(() => ({
  registerReader: vi.fn(async () => ({ success: true })),
  requestVerification: vi.fn(async () => ({ success: true })),
  tryConsume: vi.fn(() => true),
}));

vi.mock('../../hooks/domains/useUser', () => ({
  useUser: () => ({
    loading: false,
    registerReader,
    requestVerification,
    isLoggedIn: () => false,
  }),
}));

// 只替换限流器的实例方法，配置本身（5 次 / 0.2 token/s）留在组件源码里不变。
vi.mock('../../lib/security', () => ({
  RateLimiter: class {
    tryConsume = tryConsume;
  },
}));

vi.mock('../../hooks/useBreakpoint', () => ({
  default: () => ({
    isMobile: false,
    isTablet: false,
    isDesktop: true,
    currentBreakpoint: 'desktop',
    prefersReducedMotion: true,
  }),
}));

import WelcomeOverlay from './WelcomeOverlay';

const outsideButton = () => {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '打开引导';
  document.body.appendChild(button);
  button.focus();
  return button;
};

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = '';
  document.body.style.overflow = '';
});

describe('WelcomeOverlay · 出现场景与焦点契约', () => {
  it('展示页首次访问出现 dialog，焦点进入；Esc 关闭后写 welcomed 并归还焦点', async () => {
    const trigger = outsideButton();

    render(<WelcomeOverlay />);

    const dialog = await screen.findByRole('dialog', { name: '欢迎引导' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(window.localStorage.getItem('blog-welcomed')).toBeNull();
    expect(document.body.style.overflow).toBe('hidden');

    await waitFor(() => {
      expect(dialog.contains(document.activeElement), '焦点应进入 dialog').toBe(true);
    });

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '欢迎引导' })).toBeNull();
    });
    expect(window.localStorage.getItem('blog-welcomed'), '关闭后应记录已看过').toBeTruthy();
    expect(document.body.style.overflow, '关闭后应恢复滚动').not.toBe('hidden');
    expect(document.activeElement, '关闭后焦点应归还给打开前的元素').toBe(trigger);
  });

  it('Tab 在 dialog 内循环：最后一个 Tab 回第一个，第一个 Shift+Tab 回最后一个', async () => {
    render(<WelcomeOverlay />);

    const dialog = await screen.findByRole('dialog', { name: '欢迎引导' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    expect(focusables.length).toBeGreaterThan(2);

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement, '最后一个元素 Tab 应回到第一个').toBe(first);

    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement, '第一个元素 Shift+Tab 应回到最后一个').toBe(last);
  });

  it('非展示页不渲染 dialog，不阻断正文', async () => {
    window.history.replaceState({}, '', '/posts');

    render(<WelcomeOverlay />);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.queryByRole('dialog', { name: '欢迎引导' })).toBeNull();
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('/index/（实际是 404 页）不出现引导：与 BaseLayout 共用判断，只认规范首页 `/`', async () => {
    window.history.replaceState({}, '', '/index/');

    render(<WelcomeOverlay />);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.queryByRole('dialog', { name: '欢迎引导' })).toBeNull();
    expect(document.body.style.overflow).not.toBe('hidden');
  });
});

describe('WelcomeOverlay · 认证流程不可退化', () => {
  it('空表单不发起请求，提交后保留 registerReader 调用', async () => {
    render(<WelcomeOverlay />);
    await screen.findByRole('dialog', { name: '欢迎引导' });

    fireEvent.click(screen.getByRole('button', { name: /提交注册/ }));
    expect(registerReader, '必填项缺失时不应发起请求').not.toHaveBeenCalled();
    expect(await screen.findByText('请填写昵称和密码')).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/昵称/), { target: { value: 'Reader' } });
    fireEvent.change(screen.getByLabelText(/邮箱/), { target: { value: 'reader@example.com' } });
    fireEvent.change(screen.getByLabelText(/密码/), { target: { value: 'reader-pass-123' } });
    fireEvent.click(screen.getByRole('button', { name: /提交注册/ }));

    await waitFor(() => expect(registerReader).toHaveBeenCalledTimes(1));
    expect(registerReader).toHaveBeenCalledWith({
      name: 'Reader',
      email: 'reader@example.com',
      password: 'reader-pass-123',
      passwordConfirm: 'reader-pass-123',
    });
    expect(tryConsume, '提交仍应经过既有 RateLimiter').toHaveBeenCalled();
  });

  it('注册成功后出现验证步骤，重发入口仍调用 requestVerification(email)', async () => {
    render(<WelcomeOverlay />);
    await screen.findByRole('dialog', { name: '欢迎引导' });

    fireEvent.change(screen.getByLabelText(/昵称/), { target: { value: 'Reader' } });
    fireEvent.change(screen.getByLabelText(/邮箱/), { target: { value: 'reader@example.com' } });
    fireEvent.change(screen.getByLabelText(/密码/), { target: { value: 'reader-pass-123' } });
    fireEvent.click(screen.getByRole('button', { name: /提交注册/ }));

    const resend = await screen.findByRole('button', { name: /重新发送验证邮件/ });
    // 有邮箱时只给中性提示（门面无法区分重复邮箱），不得断言邮件已经送达。
    expect(screen.getByText('提交后请验证邮箱，验证完成后可评论')).toBeTruthy();
    expect(screen.getByText(/验证邮件已发送至/)).toBeTruthy();
    expect(screen.getByText('reader@example.com')).toBeTruthy();

    fireEvent.click(resend);

    await waitFor(() => expect(requestVerification).toHaveBeenCalledWith('reader@example.com'));
    expect(await screen.findByRole('button', { name: /已重新发送/ })).toBeTruthy();
  });

  it('未填写邮箱注册成功：显示「注册成功，可直接评论」，不出现验证邮件文案与重发按钮', async () => {
    render(<WelcomeOverlay />);
    const dialog = await screen.findByRole('dialog', { name: '欢迎引导' });
    // 先让打开时那次 0ms 焦点移动完成，避免它晚于成功后的焦点移动。
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    fireEvent.change(screen.getByLabelText(/昵称/), { target: { value: 'No Mail Reader' } });
    fireEvent.change(screen.getByLabelText(/密码/), { target: { value: 'reader-pass-123' } });
    fireEvent.click(screen.getByRole('button', { name: /提交注册/ }));

    await waitFor(() => expect(registerReader).toHaveBeenCalledTimes(1));
    expect(registerReader).toHaveBeenCalledWith({
      name: 'No Mail Reader',
      email: undefined,
      password: 'reader-pass-123',
      passwordConfirm: 'reader-pass-123',
    });

    // 没有邮箱就不可能发出验证邮件：不能显示「已发送至」或空转的重发按钮。
    // 无邮箱分支保留肯定文案（门面 verified = !email），且不能出现中性的「请验证邮箱」。
    expect(await screen.findByText('注册成功！')).toBeTruthy();
    expect(await screen.findByText(/注册成功，可直接评论/)).toBeTruthy();
    expect(screen.queryByText(/提交后请验证邮箱/)).toBeNull();
    expect(screen.queryByText(/验证邮件已发送至/)).toBeNull();
    expect(screen.queryByRole('button', { name: /重新发送验证邮件/ })).toBeNull();
    expect(requestVerification).not.toHaveBeenCalled();

    // 焦点不能掉到 body。
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('填写邮箱注册成功后焦点移到成功面板标题，而不是 body', async () => {
    render(<WelcomeOverlay />);
    const dialog = await screen.findByRole('dialog', { name: '欢迎引导' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    fireEvent.change(screen.getByLabelText(/昵称/), { target: { value: 'Reader' } });
    fireEvent.change(screen.getByLabelText(/邮箱/), { target: { value: 'reader@example.com' } });
    fireEvent.change(screen.getByLabelText(/密码/), { target: { value: 'reader-pass-123' } });
    fireEvent.click(screen.getByRole('button', { name: /提交注册/ }));

    // 表单（含原先聚焦的提交按钮）已卸载，焦点必须被成功面板标题接管。
    const heading = await screen.findByRole('heading', { name: '验证邮箱' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(document.activeElement, '成功后面板标题不能掉到 body').not.toBe(document.body);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('重发成功 5s 后按钮复位为「重新发送验证邮件」', async () => {
    render(<WelcomeOverlay />);
    const dialog = await screen.findByRole('dialog', { name: '欢迎引导' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    fireEvent.change(screen.getByLabelText(/昵称/), { target: { value: 'Reader' } });
    fireEvent.change(screen.getByLabelText(/邮箱/), { target: { value: 'reader@example.com' } });
    fireEvent.change(screen.getByLabelText(/密码/), { target: { value: 'reader-pass-123' } });
    fireEvent.click(screen.getByRole('button', { name: /提交注册/ }));

    const resend = await screen.findByRole('button', { name: /重新发送验证邮件/ });

    vi.useFakeTimers();
    fireEvent.click(resend);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole('button', { name: /已重新发送/ })).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByRole('button', { name: /重新发送验证邮件/ })).toBeTruthy();
  });
});
