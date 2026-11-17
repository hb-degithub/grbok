import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

import FeatureCard, { type FeatureDetail } from './FeatureCard';

/**
 * FeatureCard 回归测试：详情从「桌面 hover 浮层 / 触屏点击」统一为
 * 「原生 button 点击内联展开」，与 TechCard 同一交互模型。
 *
 * 背景：旧实现把桌面详情放在 `absolute bottom-full` 的 `role="tooltip"`
 * 浮层里，只在 `(hover: hover)` 且悬停时出现；触屏才走点击分支，而且
 * 两个分支各自渲染详情，没有 `aria-expanded` / `aria-controls` 关联。
 * 这里锁定修复后的行为契约：
 *   - 标题行是原生 `button[type=button]`，任意 hover 能力下点击都 toggle；
 *   - `aria-expanded` / `aria-controls` / 详情容器 `aria-hidden` 同步；
 *   - 详情容器始终挂载（供 grid-template-rows 过渡），内容只渲染一份；
 *   - 不再有 tooltip 浮层；
 *   - 详情容器 id 可由调用方显式传入（about 页按索引传 feature-${index}），
 *     未传时回退 useId —— useId 只在同一个 React root 内唯一，Astro 每个
 *     client:* 岛屿是独立 root，跨岛屿必须传显式 id。
 *
 * 与 TechCard.test.tsx 相同：jsdom 不合成原生 button 的 Enter/Space 激活，
 * 因此键盘部分只验证控件是原生 button 且可聚焦这一浏览器语义前提。
 */

const feature: FeatureDetail = {
  title: '安全加固',
  desc: 'CSP / HSTS / CORS 严格策略，多层速率限制，DOMPurify 防注入',
  detail: '从边缘到容器逐层设防，覆盖注入、XSS、暴力破解与滥用四大攻击面。',
  points: [
    'CSP 白名单精确到源，script-src 收紧至 self + inline 岛屿',
    '评论 / 登录 / 邮件多层速率限制，桶过期自动清理',
    'UGC 内容 DOMPurify 服务端 + 客户端双重净化',
  ],
};

/** 模拟设备 hover 能力：matches 对应 `(hover: none)` 的匹配结果。 */
function mockHoverNone(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function getToggle(title: RegExp = /安全加固/): HTMLElement {
  return screen.getByRole('button', { name: title });
}

function getPanel(toggle: HTMLElement): HTMLElement {
  const id = toggle.getAttribute('aria-controls');
  expect(id, '标题行必须通过 aria-controls 关联详情容器').toBeTruthy();
  const panel = id ? document.getElementById(id) : null;
  expect(panel, `aria-controls="${id}" 应指向已挂载的详情容器`).not.toBeNull();
  return panel as HTMLElement;
}

describe('FeatureCard（点击内联展开详情）', () => {
  beforeEach(() => {
    cleanup();
    mockHoverNone(false);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('桌面端点击标题行展开内联详情，再次点击收起', () => {
    render(<FeatureCard feature={feature} />);

    const toggle = getToggle();
    const panel = getPanel(toggle);

    // 标题行是原生 button：键盘 Enter/Space 的浏览器语义由元素类型保证。
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.getAttribute('type')).toBe('button');

    // 初始收起：容器仍挂载，但辅助技术与视觉都是隐藏状态。
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(panel.getAttribute('aria-hidden')).toBe('true');

    // 详情始终挂载：收起时文本已经在 DOM 中，展开只是画面上的 rows 过渡。
    expect(panel.textContent).toContain(feature.detail);
    for (const point of feature.points ?? []) {
      expect(panel.textContent).toContain(point);
    }

    // 桌面端点击必须生效（修复前只有 (hover: none) 才走点击分支）。
    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(panel.getAttribute('aria-hidden')).toBe('false');
    expect(panel.style.gridTemplateRows).toBe('1fr');

    // 再次点击收起；容器不卸载。
    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(panel.getAttribute('aria-hidden')).toBe('true');
    expect(panel.style.gridTemplateRows).toBe('0fr');
    expect(document.getElementById(panel.id)).not.toBeNull();
    expect(panel.textContent).toContain(feature.detail);
  });

  it.each([false, true])(
    '点击切换与设备 hover 能力无关（(hover: none) matches = %s）',
    (hoverNone) => {
      mockHoverNone(hoverNone);
      render(<FeatureCard feature={feature} />);

      const toggle = getToggle();
      const panel = getPanel(toggle);

      fireEvent.click(toggle);
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(panel.getAttribute('aria-hidden')).toBe('false');

      fireEvent.click(toggle);
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(panel.getAttribute('aria-hidden')).toBe('true');
    },
  );

  it('详情通过 grid-template-rows 过渡展开，并尊重 reduced-motion', () => {
    render(<FeatureCard feature={feature} />);

    const panel = getPanel(getToggle());
    expect(panel.className).toContain('grid');
    expect(panel.className).toContain('motion-reduce:transition-none');
    expect(panel.style.gridTemplateRows).toBe('0fr');

    fireEvent.click(getToggle());
    expect(panel.style.gridTemplateRows).toBe('1fr');
  });

  it('不再渲染 role=tooltip 的悬浮详情层', () => {
    render(<FeatureCard feature={feature} />);

    expect(screen.queryByRole('tooltip')).toBeNull();

    // 详情只存在于 aria-controls 指向的内联容器里。
    const panel = getPanel(getToggle());
    expect(panel.textContent).toContain(feature.detail);
  });

  it('保留原特性内容：标题、描述与全部要点', () => {
    render(<FeatureCard feature={feature} />);

    expect(screen.getByRole('heading', { name: /安全加固/ })).toBeTruthy();
    expect(screen.getByText(feature.desc)).toBeTruthy();
    for (const point of feature.points ?? []) {
      expect(screen.getByText(point)).toBeTruthy();
    }
  });

  it('显式 id 优先：详情容器 id 为 feature-detail-${id}', () => {
    render(<FeatureCard feature={feature} id="feature-3" />);

    const toggle = getToggle();
    const panel = getPanel(toggle);

    expect(toggle.getAttribute('aria-controls')).toBe('feature-detail-feature-3');
    expect(panel.id).toBe('feature-detail-feature-3');
  });

  it('多张卡片未传 id 时回退 useId：同一 root 内默认 id 唯一，状态互不影响', () => {
    render(
      <>
        <FeatureCard feature={feature} />
        <FeatureCard feature={{ ...feature, title: '管理员体系' }} />
      </>,
    );

    const securityToggle = getToggle(/安全加固/);
    const adminToggle = getToggle(/管理员体系/);
    const securityPanel = getPanel(securityToggle);
    const adminPanel = getPanel(adminToggle);

    // 双卡都没传 id：回退 useId，并在同一个 React root 内保持唯一。
    expect(securityPanel.id).toMatch(/^feature-detail-/);
    expect(adminPanel.id).toMatch(/^feature-detail-/);
    expect(securityPanel.id).not.toBe(adminPanel.id);

    fireEvent.click(securityToggle);

    expect(securityToggle.getAttribute('aria-expanded')).toBe('true');
    expect(securityPanel.getAttribute('aria-hidden')).toBe('false');
    expect(adminToggle.getAttribute('aria-expanded')).toBe('false');
    expect(adminPanel.getAttribute('aria-hidden')).toBe('true');
  });

  it('模拟 Astro 独立岛屿（两个独立 React root）：显式 id 仍唯一', () => {
    // 每个 client:* 岛屿是独立 React root，useId 各自从 _R_0_ 开始；只有显式 id
    // 能跨岛屿区分详情容器。about 页按索引传入 feature-${index} 正是为此。
    const firstRoot = document.createElement('div');
    const secondRoot = document.createElement('div');

    render(<FeatureCard feature={feature} id="feature-0" />, { container: firstRoot });
    render(<FeatureCard feature={{ ...feature, title: '管理员体系' }} id="feature-1" />, {
      container: secondRoot,
    });

    const firstPanel = firstRoot.querySelector('[id^="feature-detail-"]');
    const secondPanel = secondRoot.querySelector('[id^="feature-detail-"]');

    expect(firstPanel?.id).toBe('feature-detail-feature-0');
    expect(secondPanel?.id).toBe('feature-detail-feature-1');
    expect(firstPanel?.id).not.toBe(secondPanel?.id);
  });
});
