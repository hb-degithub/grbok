import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

import TechCard, { type TechDetail } from './TechCard';

/**
 * TechCard 回归测试：详情改为「点击内联展开」，桌面与触屏一致。
 *
 * 背景：旧的悬浮详情放在 `absolute bottom-full`，被 GlareHover 的
 * `overflow: hidden` 裁切；而点击展开又被 `(hover: none)` 限制，桌面端
 * 无法查看详情。这里锁定修复后的行为契约：
 *   - 紧凑行必须是原生 `button[type=button]`，可用键盘聚焦/激活；
 *   - 任意 hover 能力下点击都 toggle，不再依赖媒体查询；
 *   - `aria-expanded` / `aria-controls` / 详情容器 `aria-hidden` 同步；
 *   - 详情容器始终挂载（供 CSS 过渡），内容只出现在内联容器里，没有 tooltip 浮层；
 *   - 详情容器 id 可由调用方显式传入（about 页按索引传 tech-${index}），未传时
 *     回退 useId —— useId 只在同一个 React root 内唯一，Astro 每个 client:* 岛屿
 *     是独立 root，跨岛屿必须传显式 id。
 *
 * 说明：jsdom 不实现原生 button 的 Enter/Space → click 激活行为
 * （已实测 jsdom 29 不会合成 click），因此键盘用例验证「控件是原生 button、
 * type=button、可聚焦」这一浏览器键盘语义的前提，而非伪造 keydown 事件。
 */

const tech: TechDetail = {
  name: 'Astro 6.4',
  desc: '纯 SSG 静态生成，群岛架构',
  detail: '纯静态生成（SSG）元框架，构建产物为纯 HTML/CSS/JS，页面默认零 JS 输出。',
  points: ['群岛架构：静态 HTML + 按需水合', 'client:visible 分级水合'],
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

function getToggle(): HTMLElement {
  return screen.getByRole('button', { name: /Astro 6\.4/ });
}

function getPanel(toggle: HTMLElement): HTMLElement {
  const id = toggle.getAttribute('aria-controls');
  expect(id, '紧凑行必须通过 aria-controls 关联详情容器').toBeTruthy();
  const panel = id ? document.getElementById(id) : null;
  expect(panel, `aria-controls="${id}" 应指向已挂载的详情容器`).not.toBeNull();
  return panel as HTMLElement;
}

describe('TechCard（点击内联展开详情）', () => {
  beforeEach(() => {
    cleanup();
    mockHoverNone(false);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('桌面端点击紧凑行展开内联详情，再次点击收起', () => {
    render(<TechCard tech={tech} />);

    const toggle = getToggle();
    const panel = getPanel(toggle);

    // 初始收起：详情容器仍挂载，但对辅助技术与视觉都是隐藏状态。
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(panel.getAttribute('aria-hidden')).toBe('true');

    // 桌面端点击必须生效（修复前被 (hover: none) 排除）。
    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(panel.getAttribute('aria-hidden')).toBe('false');
    expect(panel.textContent).toContain(tech.detail);
    for (const point of tech.points ?? []) {
      expect(panel.textContent).toContain(point);
    }

    // 再次点击收起；始终挂载（供 grid-template-rows 过渡），不是条件卸载。
    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(panel.getAttribute('aria-hidden')).toBe('true');
    expect(document.getElementById(panel.id)).not.toBeNull();
    expect(panel.textContent).toContain(tech.detail);
  });

  it.each([false, true])(
    '点击切换与设备 hover 能力无关（(hover: none) matches = %s）',
    (hoverNone) => {
      mockHoverNone(hoverNone);
      render(<TechCard tech={tech} />);

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

  it('紧凑行是原生 button[type=button]：可聚焦，键盘语义由浏览器保证', () => {
    render(<TechCard tech={tech} />);

    const toggle = getToggle();
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.getAttribute('type')).toBe('button');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    toggle.focus();
    expect(document.activeElement).toBe(toggle);

    // 键盘激活等价于原生 click；这里验证聚焦后的激活同样切换状态。
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('不再渲染被裁切的悬浮 tooltip 浮层', () => {
    render(<TechCard tech={tech} />);

    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('显式 id 优先：详情容器 id 为 tech-detail-${id}', () => {
    render(<TechCard tech={tech} id="tech-0" />);

    const toggle = getToggle();
    const panel = getPanel(toggle);

    expect(toggle.getAttribute('aria-controls')).toBe('tech-detail-tech-0');
    expect(panel.id).toBe('tech-detail-tech-0');
  });

  it('多张卡片未传 id 时回退 useId：同一 root 内默认 id 唯一，状态互不影响', () => {
    render(
      <>
        <TechCard tech={tech} />
        <TechCard tech={{ ...tech, name: 'React 19' }} />
      </>,
    );

    const [astroToggle, reactToggle] = screen.getAllByRole('button');
    const astroPanel = getPanel(astroToggle);
    const reactPanel = getPanel(reactToggle);

    // 双卡都没传 id：回退 useId，并在同一个 React root 内保持唯一。
    expect(astroPanel.id).toMatch(/^tech-detail-/);
    expect(reactPanel.id).toMatch(/^tech-detail-/);
    expect(astroPanel.id).not.toBe(reactPanel.id);

    fireEvent.click(astroToggle);

    expect(astroToggle.getAttribute('aria-expanded')).toBe('true');
    expect(astroPanel.getAttribute('aria-hidden')).toBe('false');
    expect(reactToggle.getAttribute('aria-expanded')).toBe('false');
    expect(reactPanel.getAttribute('aria-hidden')).toBe('true');
  });

  it('模拟 Astro 独立岛屿（两个独立 React root）：显式 id 仍唯一', () => {
    // 每个 client:* 岛屿是独立 React root，useId 各自从 _R_0_ 开始；只有显式 id
    // 能跨岛屿区分详情容器。about 页按索引传入 tech-${index} 正是为此。
    const firstRoot = document.createElement('div');
    const secondRoot = document.createElement('div');

    render(<TechCard tech={tech} id="tech-0" />, { container: firstRoot });
    render(<TechCard tech={{ ...tech, name: 'React 19' }} id="tech-1" />, {
      container: secondRoot,
    });

    const firstPanel = firstRoot.querySelector('[id^="tech-detail-"]');
    const secondPanel = secondRoot.querySelector('[id^="tech-detail-"]');

    expect(firstPanel?.id).toBe('tech-detail-tech-0');
    expect(secondPanel?.id).toBe('tech-detail-tech-1');
    expect(firstPanel?.id).not.toBe(secondPanel?.id);
  });
});
