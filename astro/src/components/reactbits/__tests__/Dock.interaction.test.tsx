import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

/**
 * Dock 交互回归：Dock.css 只允许换视觉令牌，放大/键盘/语义必须保持。
 * 这里渲染真实组件，验证按钮项的 Enter/Space 键盘触发与链接项的 aria 语义。
 */

import Dock from '../Dock';

afterEach(cleanup);

describe('Dock（导航工具栏）', () => {
  it('toolbar 语义与按钮项键盘触发保留', () => {
    const onClick = vi.fn();
    render(<Dock items={[{ icon: <span />, label: '搜索', onClick }]} />);

    expect(screen.getByRole('toolbar', { name: '站点导航工具栏' })).toBeTruthy();

    const button = screen.getByRole('button', { name: '搜索' });
    fireEvent.keyDown(button, { key: 'Enter' });
    fireEvent.keyDown(button, { key: ' ' });

    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('链接项保留 href 与当前页语义', () => {
    render(<Dock items={[{ icon: <span />, label: '文章', href: '/posts', active: true }]} />);

    const link = screen.getByRole('link', { name: '文章' });
    expect(link.getAttribute('href')).toBe('/posts');
    expect(link.getAttribute('aria-current')).toBe('page');
  });
});
