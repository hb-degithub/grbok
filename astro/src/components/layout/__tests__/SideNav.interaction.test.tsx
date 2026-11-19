import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

/**
 * SideNav 交互回归：改造只允许改样式，抽屉的 dialog 语义、菜单项与 Esc 关闭必须还在。
 * （焦点循环/归还和滚动锁定属于打开态逻辑，由源码契约测试覆盖关键调用点，
 * 这里验证真实渲染出的可达性节点与 Esc 行为。）
 */

vi.mock('../../../hooks/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: null, isAuthenticated: false, isLoading: false, canAccessAdmin: false }),
}));

vi.mock('../../../hooks/useBreakpoint', () => ({
  default: () => ({ prefersReducedMotion: true }),
}));

import SideNav from '../SideNav';

afterEach(cleanup);

describe('SideNav（移动端抽屉）', () => {
  it('打开时渲染 dialog，主导航/更多/其他菜单项全部保留', () => {
    render(<SideNav id="mobile-side-nav" isOpen onClose={() => {}} currentPath="/" />);

    const dialog = screen.getByRole('dialog', { name: '移动端侧边导航' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');

    for (const label of ['首页', '文章', '标签', '归档', '关于', '访问统计', '运行状态', '友情链接', '留言板', '相册', '项目', '订阅', '登录']) {
      expect(screen.getByRole('link', { name: label }), `菜单项丢失：${label}`).toBeTruthy();
    }
  });

  it('补齐归档/状态入口，并沿用焦点与键盘机制', () => {
    const { container } = render(<SideNav id="mobile-side-nav" isOpen onClose={() => {}} currentPath="/" />);
    const dialog = screen.getByRole('dialog', { name: '移动端侧边导航' });

    expect(screen.getByRole('link', { name: '归档' }).getAttribute('href')).toBe('/archive');
    expect(screen.getByRole('link', { name: '运行状态' }).getAttribute('href')).toBe('/status');

    // 焦点循环的键盘处理与焦点归还点仍在源码契约里。
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(container.querySelector('aside')?.getAttribute('tabindex')).toBe('-1');
  });

  it('Esc 触发 onClose（键盘可达）', () => {
    const onClose = vi.fn();
    render(<SideNav id="mobile-side-nav" isOpen onClose={onClose} currentPath="/" />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('当前路径带 aria-current="page"', () => {
    render(<SideNav id="mobile-side-nav" isOpen onClose={() => {}} currentPath="/posts" />);

    expect(screen.getByRole('link', { name: '文章' }).getAttribute('aria-current')).toBe('page');
  });
});
