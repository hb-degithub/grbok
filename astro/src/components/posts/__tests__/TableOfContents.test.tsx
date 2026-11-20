import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * 目录（TOC）行为契约（阅读路径 · 目录与移动布局）。
 *
 * 只验证用户可感知行为：
 *   1. 桌面是带 aria-label 的导航，锚点 href 指向 heading id；
 *   2. 移动端是折叠按钮 + aria-expanded/aria-controls，展开后可跳转到标题并自动收起；
 *   3. 标题为三级时缩进一档；无标题时不渲染（页面不出现空目录）。
 *
 * 组件本身不修改，这里守护它在详情页改造后仍按预期工作。
 */

const breakpoint = vi.hoisted(() => ({ isMobile: false }));

vi.mock('../../../hooks/useBreakpoint', () => ({
  default: () => ({
    isMobile: breakpoint.isMobile,
    isTablet: false,
    isDesktop: !breakpoint.isMobile,
    currentBreakpoint: breakpoint.isMobile ? 'mobile' : 'desktop',
    prefersReducedMotion: false,
  }),
}));

import TableOfContents from '../TableOfContents';

const HEADINGS = [
  { id: 'heading-0', text: '第一节', level: 2 },
  { id: 'heading-1', text: '小节', level: 3 },
];

function appendHeading(id: string) {
  const heading = document.createElement('h2');
  heading.id = id;
  document.body.appendChild(heading);
  return heading;
}

beforeEach(() => {
  breakpoint.isMobile = false;
  // framer-motion 的 useReducedMotion 会读 matchMedia；jsdom 默认没有实现。
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    }),
  });
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      constructor(_cb: unknown, _opts?: unknown) {}
    },
  );
  cleanup();
});

afterEach(() => {
  document.body.innerHTML = '';
  cleanup();
  vi.unstubAllGlobals();
});

describe('目录 · 桌面', () => {
  it('渲染带标签的导航与指向 heading id 的锚点', () => {
    render(<TableOfContents headings={HEADINGS} />);

    const nav = screen.getByRole('navigation', { name: '目录' });
    expect(nav).toBeTruthy();

    const links = Array.from(nav.querySelectorAll('a'));
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute('href')).toBe('#heading-0');
    expect(links[1].getAttribute('href')).toBe('#heading-1');
    // 三级标题缩进一档，层级可辨
    expect(links[1].className).toContain('pl-7');
    expect(links[0].className).toContain('pl-3');
  });

  it('点击锚点滚动到对应标题', () => {
    const target = appendHeading('heading-0');
    const scrollIntoView = vi.fn();
    Object.defineProperty(target, 'scrollIntoView', { value: scrollIntoView });

    render(<TableOfContents headings={HEADINGS} />);
    const link = screen.getByRole('navigation', { name: '目录' }).querySelector('a');
    expect(link).toBeTruthy();

    fireEvent.click(link as HTMLAnchorElement);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    // 桌面侧栏保持平滑滚动。
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth' });
  });
});

describe('目录 · 移动端', () => {
  it('折叠按钮带 aria-expanded/aria-controls，展开后显示目录', async () => {
    breakpoint.isMobile = true;
    render(<TableOfContents headings={HEADINGS} />);

    const toggle = screen.getByRole('button', { name: /目录/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe('toc-mobile-panel');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await waitFor(() => expect(document.getElementById('toc-mobile-panel')).toBeTruthy());
  });

  it('移动端先收起面板再滚动，避免卸载取消滚动（R2 竞态回归）', async () => {
    breakpoint.isMobile = true;
    const target = appendHeading('heading-0');
    const scrollIntoView = vi.fn();
    Object.defineProperty(target, 'scrollIntoView', { value: scrollIntoView });

    render(<TableOfContents headings={HEADINGS} />);
    fireEvent.click(screen.getByRole('button', { name: /目录/ }));
    await waitFor(() => expect(document.getElementById('toc-mobile-panel')).toBeTruthy());

    const link = document.querySelector('#toc-mobile-panel a');
    expect(link).toBeTruthy();
    fireEvent.click(link as HTMLAnchorElement);

    // 竞态回归点：面板里还挂着被点击的链接时不能开始滚动。
    // 旧实现先 scrollIntoView({behavior:'smooth'}) 再 setMobileOpen(false)，
    // AnimatePresence 收起并卸载链接会取消这次平滑滚动。
    expect(scrollIntoView).not.toHaveBeenCalled();

    // 面板退出动画结束、节点真正移除之后，目标标题才开始滚动。
    await waitFor(() => expect(document.getElementById('toc-mobile-panel')).toBeNull());
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth' });
  });

  it('移动端点击目录项跳转后自动收起', async () => {
    breakpoint.isMobile = true;
    const target = appendHeading('heading-0');
    Object.defineProperty(target, 'scrollIntoView', { value: vi.fn() });

    render(<TableOfContents headings={HEADINGS} />);
    fireEvent.click(screen.getByRole('button', { name: /目录/ }));
    await waitFor(() => expect(document.getElementById('toc-mobile-panel')).toBeTruthy());

    const link = document.querySelector('#toc-mobile-panel a');
    expect(link).toBeTruthy();
    fireEvent.click(link as HTMLAnchorElement);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /目录/ }).getAttribute('aria-expanded')).toBe('false'),
    );
  });
});

describe('目录 · 空标题', () => {
  it('headings 为空时不渲染任何导航', () => {
    const { container } = render(<TableOfContents headings={[]} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});
