import React, { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * AltchaField 契约测试。
 *
 * jsdom 里无法真正跑 PoW（挑战接口是真实网络请求），因此把 `altcha` 的两条
 * 子路径换成「只注册一个空自定义元素」的替身：
 *   - 组件仍然走真实代码路径（动态 import + customElements 探测 + 事件绑定）；
 *   - widget 自己不会自发派发事件，测试用 dispatchEvent 精确驱动状态机。
 *
 * 覆盖点：协议属性（challengeurl/name/auto/language）、statechange → 回调、
 * SSR 输出、以及 ref.reset() 会重建元素（重新取挑战）并清空 payload。
 */

vi.mock('altcha', async () => {
  if (typeof customElements !== 'undefined' && !customElements.get('altcha-widget')) {
    customElements.define('altcha-widget', class extends HTMLElement {});
  }
  return {};
});

vi.mock('altcha/i18n/zh-cn', () => ({}));

import AltchaField, { type AltchaFieldHandle } from '../AltchaField';

function widget(): HTMLElement {
  const element = document.querySelector('altcha-widget');
  expect(element, 'altcha-widget 未渲染').toBeTruthy();
  return element as HTMLElement;
}

function emitState(state: string, payload?: string) {
  act(() => {
    widget().dispatchEvent(new CustomEvent('statechange', { detail: { state, payload } }));
  });
}

afterEach(cleanup);

describe('AltchaField · 协议属性', () => {
  it('使用 v1 协议的 challengeurl / name / auto / language 属性', () => {
    render(<AltchaField onVerified={vi.fn()} />);

    const element = widget();
    expect(element.getAttribute('challengeurl')).toBe('/api/captcha/challenge');
    expect(element.getAttribute('name')).toBe('altcha');
    expect(element.getAttribute('auto')).toBe('onload');
    expect(element.getAttribute('language')).toBe('zh-cn');
  });

  it('SSR 直接输出静态标签，不触发动态 import', () => {
    const html = renderToStaticMarkup(<AltchaField onVerified={vi.fn()} />);

    expect(html).toContain('<altcha-widget');
    expect(html).toContain('challengeurl="/api/captcha/challenge"');
    expect(html).toContain('data-altcha-status="pending"');
  });
});

describe('AltchaField · statechange → 表单回调', () => {
  it('未验证（unverified）→ 通知表单 blocked 且 payload 为 null', () => {
    const onVerified = vi.fn();
    const onStatusChange = vi.fn();
    render(<AltchaField onVerified={onVerified} onStatusChange={onStatusChange} />);

    emitState('unverified');

    expect(onStatusChange).toHaveBeenLastCalledWith('blocked');
    expect(onVerified).toHaveBeenLastCalledWith(null);
    expect(screen.getByText(/请先完成人机验证/)).toBeTruthy();
  });

  it('已验证（verified）→ 把 base64 payload 交给表单', () => {
    const onVerified = vi.fn();
    const onStatusChange = vi.fn();
    render(<AltchaField onVerified={onVerified} onStatusChange={onStatusChange} />);

    emitState('verified', 'cGF5bG9hZA==');

    expect(onVerified).toHaveBeenLastCalledWith('cGF5bG9hZA==');
    expect(onStatusChange).toHaveBeenLastCalledWith('verified');
    expect(screen.queryByText(/请先完成人机验证/)).toBeNull();
  });

  it('验证中（verifying）仍属于未验证，提示「正在完成人机验证」', () => {
    const onStatusChange = vi.fn();
    render(<AltchaField onVerified={vi.fn()} onStatusChange={onStatusChange} />);

    emitState('verifying');

    expect(onStatusChange).toHaveBeenLastCalledWith('blocked');
    expect(screen.getByText('正在完成人机验证…')).toBeTruthy();
  });

  it('过期（expired）→ 清空 payload 并保持拦截', () => {
    const onVerified = vi.fn();
    render(<AltchaField onVerified={onVerified} />);

    emitState('verified', 'cGF5bG9hZA==');
    emitState('expired');

    expect(onVerified).toHaveBeenLastCalledWith(null);
    expect(screen.getByText('验证已过期，正在重新验证…')).toBeTruthy();
  });

  it('widget 报错（挑战接口不可用）→ 降级为 unavailable 并放行提交', () => {
    const onVerified = vi.fn();
    const onStatusChange = vi.fn();
    render(<AltchaField onVerified={onVerified} onStatusChange={onStatusChange} />);

    emitState('error');

    expect(onStatusChange).toHaveBeenLastCalledWith('unavailable');
    expect(onVerified).toHaveBeenLastCalledWith(null);
    expect(screen.getByText(/人机验证组件暂时不可用/)).toBeTruthy();
    // 降级时提供手动重试入口
    expect(screen.getByRole('button', { name: '重新验证' })).toBeTruthy();
  });
});

describe('AltchaField · reset()', () => {
  it('重建 widget（重新取挑战）并清空已拿到的 payload', () => {
    const onVerified = vi.fn();
    const ref = createRef<AltchaFieldHandle>();
    render(<AltchaField ref={ref} onVerified={onVerified} />);

    emitState('verified', 'b2xkLXBheWxvYWQ=');
    expect(onVerified).toHaveBeenLastCalledWith('b2xkLXBheWxvYWQ=');

    const before = widget();
    act(() => {
      ref.current?.reset();
    });

    expect(onVerified).toHaveBeenLastCalledWith(null);
    expect(widget()).not.toBe(before);
    // 新元素重新带上挑战地址，而不是复用已消费的 challenge
    expect(widget().getAttribute('challengeurl')).toBe('/api/captcha/challenge');
  });

  it('resetSignal 自增等价于 ref.reset()', () => {
    const onVerified = vi.fn();
    const { rerender } = render(<AltchaField resetSignal={0} onVerified={onVerified} />);

    emitState('verified', 'cGF5bG9hZA==');
    const before = widget();

    rerender(<AltchaField resetSignal={1} onVerified={onVerified} />);

    expect(onVerified).toHaveBeenLastCalledWith(null);
    expect(widget()).not.toBe(before);
  });
});
