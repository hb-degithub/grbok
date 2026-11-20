import React, { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import GalleryLightbox from '../GalleryLightbox';

/**
 * 灯箱行为契约：dialog 标题、焦点进入 / Tab 循环 / 归还、键盘导航。
 *
 * 现状问题（实现前）：
 * - 只有泛化的 `aria-label="查看大图"`，读屏无法知道当前是哪张照片；
 * - 打开后焦点留在触发按钮上（没有进入 dialog），Tab 会跑到遮罩后面的页面；
 * - 关闭后没有把焦点归还给打开灯箱的照片按钮。
 */

interface Item {
  id: string;
  photo: string;
  title?: string;
  description?: string;
}

const items: Item[] = [
  { id: 'p1', photo: 'one.jpg', title: '海边的清晨', description: '潮汐与礁石' },
  { id: 'p2', photo: 'two.jpg', title: '山谷的午后' },
  { id: 'p3', photo: 'three.jpg' },
];
const urls = ['/photos/one.jpg', '/photos/two.jpg', '/photos/three.jpg'];

function Harness() {
  const [index, setIndex] = useState<number | null>(null);
  return (
    <div>
      <button type="button" onClick={() => setIndex(2)}>
        打开最后一张
      </button>
      <button type="button" onClick={() => setIndex(0)}>
        打开相册大图
      </button>
      <GalleryLightbox
        items={items}
        urls={urls}
        index={index}
        onClose={() => setIndex(null)}
        onNavigate={setIndex}
      />
    </div>
  );
}

async function openLightbox() {
  render(<Harness />);
  const trigger = screen.getByRole('button', { name: '打开相册大图' });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = await screen.findByRole('dialog');
  return { trigger, dialog };
}

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
  document.body.style.paddingRight = '';
});

describe('GalleryLightbox · dialog 标题与焦点', () => {
  it('dialog 的可访问名称来自当前照片标题，并在切换后更新', async () => {
    await openLightbox();

    expect(screen.getByRole('dialog', { name: '查看大图：海边的清晨' })).toBeTruthy();

    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(await screen.findByRole('dialog', { name: '查看大图：山谷的午后' })).toBeTruthy();

    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(await screen.findByRole('dialog', { name: '查看大图：海边的清晨' })).toBeTruthy();
  });

  it('没有标题时回退到「相册图片」，不丢掉 dialog 名称', async () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: '打开最后一张' });
    fireEvent.click(trigger);

    expect(await screen.findByRole('dialog', { name: '查看大图：相册图片' })).toBeTruthy();
  });

  it('打开后焦点进入灯箱，关闭后归还给触发按钮', async () => {
    const { trigger } = await openLightbox();

    const close = await screen.findByRole('button', { name: '关闭' });
    await waitFor(() => expect(document.activeElement).toBe(close));

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('Tab / Shift+Tab 在灯箱内循环，焦点不会逃逸到页面', async () => {
    await openLightbox();

    const close = await screen.findByRole('button', { name: '关闭' });
    const next = await screen.findByRole('button', { name: '下一张' });
    await waitFor(() => expect(document.activeElement).toBe(close));

    // 最后一个 → 第一个
    next.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(close);

    // 第一个 → 最后一个（Shift+Tab）
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(next);

    // 焦点被页面其它元素抢走后，Tab 会拉回灯箱
    const outside = document.createElement('button');
    outside.textContent = '页面外部按钮';
    document.body.appendChild(outside);
    outside.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    outside.remove();
  });

  it('方向键切换照片并停在边界，Esc 关闭', async () => {
    await openLightbox();

    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(screen.getByRole('dialog', { name: '查看大图：海边的清晨' })).toBeTruthy();

    fireEvent.keyDown(document, { key: 'ArrowRight' });
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(await screen.findByRole('dialog', { name: '查看大图：相册图片' })).toBeTruthy();

    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(screen.getByRole('dialog', { name: '查看大图：相册图片' })).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('打开时锁滚动，关闭后恢复原始样式', async () => {
    const { trigger } = await openLightbox();
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.body.style.overflow).toBe('');
  });
});
