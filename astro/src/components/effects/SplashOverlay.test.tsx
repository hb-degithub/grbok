import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';

/**
 * SplashOverlay 回归。
 *
 * 启动条是非阻断的一次性状态条，但有一个容易漏掉的边界：
 * `prefers-reduced-motion` 可能在启动条已经显示后才从 false 变成 true。
 * 此时 effect 的 cleanup 会清掉自动退场 timer；如果只 `return` 而不收起可见状态，
 * 启动条就会永久留在页面上。这里锁定「切换为 reduce 时立即 setVisible(false)」。
 */

const breakpoint = vi.hoisted(() => ({ reducedMotion: false }));

vi.mock('../../hooks/useBreakpoint', () => ({
  default: () => ({
    isMobile: false,
    isTablet: false,
    isDesktop: true,
    currentBreakpoint: 'desktop',
    prefersReducedMotion: breakpoint.reducedMotion,
  }),
}));

import SplashOverlay from './SplashOverlay';

beforeEach(() => {
  window.localStorage.clear();
  breakpoint.reducedMotion = false;
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('SplashOverlay · 减少动效与自动退场', () => {
  it('减少动效时首次访问直接标记已看过，不渲染启动条', () => {
    breakpoint.reducedMotion = true;

    render(<SplashOverlay />);

    expect(screen.queryByRole('status')).toBeNull();
    expect(window.localStorage.getItem('blog-splash-seen')).toBeTruthy();
  });

  it('正常模式显示启动条，1.6s 后自动退场并写入查看标记', () => {
    render(<SplashOverlay />);

    expect(screen.getByRole('status', { name: '页面加载中' })).toBeTruthy();
    expect(window.localStorage.getItem('blog-splash-seen')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1600);
    });

    expect(screen.queryByRole('status')).toBeNull();
    expect(window.localStorage.getItem('blog-splash-seen')).toBeTruthy();
  });

  it('启动条显示后切换为减少动效：立即收起并清理 timer，不会永久残留', () => {
    const { rerender } = render(<SplashOverlay />);
    expect(screen.getByRole('status')).toBeTruthy();

    // false → true：旧 timer 被 effect cleanup 清掉，可见状态也必须同步收起。
    breakpoint.reducedMotion = true;
    rerender(<SplashOverlay />);

    expect(screen.queryByRole('status')).toBeNull();
    expect(window.localStorage.getItem('blog-splash-seen')).toBeTruthy();

    // 再推进任意长时间也不应重新出现（不会留下一个仍会触发的 timer）。
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.queryByRole('status'), '清理 timer 后启动条不应再次出现').toBeNull();
  });
});
