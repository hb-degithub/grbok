import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

/**
 * Task C：认证方式 tab 的 ARIA 与键盘契约。
 *
 * 行为契约（WAI-ARIA Tabs, automatic activation）：
 * - 三个 tab 与一个 tabpanel；tab 通过 aria-controls 指向 panel，
 *   panel 通过 aria-labelledby 指回当前 tab。
 * - roving tabindex：只有选中项 tabIndex=0，其余 -1。
 * - ArrowLeft / ArrowRight 循环切换，Home / End 跳到首尾，焦点随选中项移动。
 * - tab 顺序与标签文案固定：密码登录 / 验证码 / 注册。
 *
 * 只 mock 三个子表单，避免测试把登录/注册业务逻辑再测一遍。
 */
vi.mock('../PasswordLoginForm', () => ({ default: () => null }));
vi.mock('../MagicLinkForm', () => ({ default: () => null }));
vi.mock('../RegisterForm', () => ({ default: () => null }));

import AuthPage from '../AuthPage';

afterEach(cleanup);

function getTabs(): HTMLButtonElement[] {
  return screen.getAllByRole('tab') as HTMLButtonElement[];
}

function selectedStates(): Array<string | null> {
  return getTabs().map((tab) => tab.getAttribute('aria-selected'));
}

function tabIndexes(): number[] {
  return getTabs().map((tab) => tab.tabIndex);
}

describe('AuthPage 认证方式 tab', () => {
  it('保留三个 tab，建立 roving tabindex 与 aria-controls/tabpanel 关联', () => {
    render(<AuthPage />);

    const tabs = getTabs();
    expect(tabs.map((tab) => tab.textContent)).toEqual(['密码登录', '验证码', '注册']);
    expect(selectedStates()).toEqual(['true', 'false', 'false']);
    expect(tabIndexes()).toEqual([0, -1, -1]);

    for (const tab of tabs) {
      expect(tab.id, 'tab 缺少稳定 id').toBeTruthy();
      expect(tab.getAttribute('aria-controls'), 'tab 缺少 aria-controls').toBeTruthy();
    }

    const panel = screen.getByRole('tabpanel');
    expect(panel.id).toBe(tabs[0].getAttribute('aria-controls'));
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs[0].id);
    expect(panel.tabIndex).toBe(0);
  });

  it('ArrowRight / ArrowLeft 循环切换，且焦点随选中项移动', () => {
    render(<AuthPage />);
    const tabs = getTabs();

    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tabs[1]);
    expect(selectedStates()).toEqual(['false', 'true', 'false']);
    expect(tabIndexes()).toEqual([-1, 0, -1]);
    expect(screen.getByRole('tabpanel').id).toBe(tabs[1].getAttribute('aria-controls'));

    fireEvent.keyDown(tabs[1], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tabs[2]);
    expect(selectedStates()).toEqual(['false', 'false', 'true']);

    // 末尾继续右移回到首项
    fireEvent.keyDown(tabs[2], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tabs[0]);
    expect(selectedStates()).toEqual(['true', 'false', 'false']);

    // 首项左移回到末项
    fireEvent.keyDown(tabs[0], { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tabs[2]);
    expect(selectedStates()).toEqual(['false', 'false', 'true']);
  });

  it('Home / End 跳到首尾，点击仍可切换', () => {
    render(<AuthPage />);
    const tabs = getTabs();

    tabs[1].focus();
    fireEvent.keyDown(tabs[1], { key: 'End' });
    expect(document.activeElement).toBe(tabs[2]);
    expect(selectedStates()).toEqual(['false', 'false', 'true']);

    fireEvent.keyDown(tabs[2], { key: 'Home' });
    expect(document.activeElement).toBe(tabs[0]);
    expect(selectedStates()).toEqual(['true', 'false', 'false']);

    fireEvent.click(tabs[1]);
    expect(selectedStates()).toEqual(['false', 'true', 'false']);
    expect(screen.getByRole('tabpanel').id).toBe(tabs[1].getAttribute('aria-controls'));
  });
});
