import { describe, expect, it } from 'vitest';
import { isShowcasePathname } from './showcase-path';

/**
 * 展示页判断的单一来源回归。
 *
 * 背景：`BaseLayout` 与 `WelcomeOverlay` 曾各写一套首页判断（前者接受 `/` 和 `/index/`，
 * 后者只接受 `/`），结果 `/index/` 上岛挂载了却不弹欢迎引导；而 `/index/` 实际是 404 页，
 * 本就不该展示首页特效。现在两边共用这个函数，只认规范首页 `/`。
 */

describe('isShowcasePathname', () => {
  it('只把规范首页 / 当展示页', () => {
    expect(isShowcasePathname('/')).toBe(true);
  });

  it('/index/ 走的是 404 页，不算展示页', () => {
    expect(isShowcasePathname('/index/')).toBe(false);
    expect(isShowcasePathname('/index')).toBe(false);
    expect(isShowcasePathname('/index.html')).toBe(false);
  });

  it('内页一律不算展示页', () => {
    for (const pathname of ['/posts', '/posts/', '/about', '/login', '/admin', '/status', '/tags/astro']) {
      expect(isShowcasePathname(pathname), `${pathname} 不是展示页`).toBe(false);
    }
  });

  it('不做前缀/后缀/归一化匹配，避免把范围扩大到内页', () => {
    for (const pathname of ['', '//', '/?page=2', '/posts/index/', '/ ', ' /']) {
      expect(isShowcasePathname(pathname), `${pathname} 不应被当成展示页`).toBe(false);
    }
  });
});
