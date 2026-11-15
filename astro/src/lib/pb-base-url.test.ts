import { describe, it, expect, vi, afterEach } from 'vitest';
import { pbBaseUrl } from './pb-base-url';

/**
 * pbBaseUrl() 两端地址解析的回归测试。
 *
 * 背景：生产 SSR 曾用烘焙进产物的公网域名回源 PocketBase，请求绕回 ESA/SafeLine
 * 被 WAF 返回 403 挑战页，导致首页无文章、详情页「文章不存在」。
 * 这里锁定两条边界：浏览器=公网地址，服务端=运行时 PB_SERVER_URL（回环直连）。
 */

afterEach(() => {
  // 还原 window 与 import.meta.env / process.env 的临时改动，避免用例互相污染。
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('pbBaseUrl', () => {
  it('浏览器分支返回公网地址', () => {
    vi.stubEnv('PUBLIC_POCKETBASE_URL', 'https://hlydwz.com');
    // jsdom 环境下 window 存在，即浏览器分支
    expect(typeof window).toBe('object');
    expect(pbBaseUrl()).toBe('https://hlydwz.com');
  });

  it('服务端分支优先使用 PB_SERVER_URL 回环地址', () => {
    vi.stubEnv('PUBLIC_POCKETBASE_URL', 'https://hlydwz.com');
    vi.stubEnv('PB_SERVER_URL', 'http://127.0.0.1:18080');
    // 模拟 SSR：没有 window
    vi.stubGlobal('window', undefined);
    expect(pbBaseUrl()).toBe('http://127.0.0.1:18080');
  });

  it('服务端未配置 PB_SERVER_URL 时回退到公网地址', () => {
    vi.stubEnv('PUBLIC_POCKETBASE_URL', 'https://hlydwz.com');
    vi.stubEnv('PB_SERVER_URL', '');
    vi.stubGlobal('window', undefined);
    expect(pbBaseUrl()).toBe('https://hlydwz.com');
  });

  it('两端都会去掉尾部斜杠', () => {
    vi.stubEnv('PUBLIC_POCKETBASE_URL', 'https://hlydwz.com///');
    expect(pbBaseUrl()).toBe('https://hlydwz.com');

    vi.stubEnv('PB_SERVER_URL', 'http://127.0.0.1:18080/');
    vi.stubGlobal('window', undefined);
    expect(pbBaseUrl()).toBe('http://127.0.0.1:18080');
  });
});
