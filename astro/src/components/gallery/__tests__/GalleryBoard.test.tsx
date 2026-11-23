import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * 相册面板行为契约：
 * - 加载失败必须显示可重试的错误态，并与「相册为空」区分；
 * - 重试走 useGallery 的真实 load()（不再是一次性的错误文案）；
 * - 点开照片后灯箱获得焦点，关闭后焦点回到那张照片；
 * - 列表用 300x300、灯箱用 1600x0 的缩略图，**任何场景都不请求原图**
 *   （单张原图实测 9.25MB，首屏直接拉原图会把流量打爆）；
 * - 列表图片懒加载 + 异步解码。
 */

const { getItemsMock, getPhotoUrlMock } = vi.hoisted(() => ({
  getItemsMock: vi.fn(),
  getPhotoUrlMock: vi.fn((item: { photo?: string }, thumb?: string) => {
    const file = typeof item?.photo === 'string' ? item.photo : 'photo.jpg';
    return thumb ? `/thumbs/${thumb}/${file}` : `/photos/${file}`;
  }),
}));

vi.mock('../../../lib/services/galleryService', () => ({
  galleryService: {
    getItems: getItemsMock,
    getPhotoUrl: getPhotoUrlMock,
  },
  // GalleryBoard 从同一模块取尺寸常量；mock 必须一并导出，否则命名导入会抛错。
  GALLERY_LIST_THUMB: '300x300',
  GALLERY_LIGHTBOX_THUMB: '1600x0',
}));

vi.mock('../../../hooks/useBreakpoint', () => ({
  default: () => ({
    isMobile: false,
    isTablet: false,
    isDesktop: true,
    currentBreakpoint: 'desktop',
    prefersReducedMotion: false,
  }),
}));

import GalleryBoard from '../GalleryBoard';

function makeItem(id: string, title: string, album = '旅行') {
  return {
    id,
    title,
    description: '',
    album,
    sort_order: 0,
    status: 'show',
    photo: `${id}.jpg`,
    collectionId: 'gallery_items',
    collectionName: 'gallery_items',
    created: '2026-01-01 00:00:00.000Z',
    updated: '2026-01-01 00:00:00.000Z',
  };
}

beforeEach(() => {
  getItemsMock.mockReset();
  getPhotoUrlMock.mockClear();
});

afterEach(cleanup);

describe('GalleryBoard · 加载失败与真实重试', () => {
  it('加载失败显示可重试错误态，且不冒充空相册', async () => {
    getItemsMock.mockRejectedValue(new Error('network down'));

    render(<GalleryBoard />);

    const alert = await screen.findByRole('alert');
    expect(alert.getAttribute('data-state')).toBe('error');
    expect(alert.textContent).toContain('相册加载失败');
    expect(screen.queryByText(/相册还是空的/)).toBeNull();
  });

  it('点击重新加载会真实重新取数，成功后渲染照片', async () => {
    getItemsMock.mockRejectedValue(new Error('network down'));

    render(<GalleryBoard />);
    await screen.findByRole('alert');

    getItemsMock.mockResolvedValueOnce([makeItem('p1', '海边的清晨')]);
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));

    expect(await screen.findByRole('img', { name: '海边的清晨' })).toBeTruthy();
    expect(getItemsMock.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('真空相册显示空态（与错误态区分）', async () => {
    getItemsMock.mockResolvedValue([]);

    render(<GalleryBoard />);

    const empty = await screen.findByText('相册还是空的，等博主上传第一批照片。');
    expect(empty.closest('[data-state]')?.getAttribute('data-state')).toBe('empty');
  });

  it('刷新失败时保留已经加载的照片，只就地提示', async () => {
    getItemsMock
      .mockResolvedValueOnce([makeItem('p1', '海边的清晨')])
      .mockRejectedValueOnce(new Error('refresh failed'));

    render(<GalleryBoard />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('相册刷新失败');
    expect(screen.getByRole('img', { name: '海边的清晨' })).toBeTruthy();
  });

  it('打开灯箱后焦点进入 dialog，关闭后归还给照片按钮', async () => {
    getItemsMock.mockResolvedValue([makeItem('p1', '海边的清晨'), makeItem('p2', '山谷的午后')]);

    render(<GalleryBoard />);
    const photo = await screen.findByRole('button', { name: '查看大图：海边的清晨' });
    photo.focus();
    fireEvent.click(photo);

    await screen.findByRole('dialog', { name: '查看大图：海边的清晨' });
    const close = await screen.findByRole('button', { name: '关闭' });
    await waitFor(() => expect(document.activeElement).toBe(close));

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(photo));
  });
});

describe('GalleryBoard · 加载性能（缩略图，不请求原图）', () => {
  it('列表图片使用 300x300 缩略图并懒加载', async () => {
    getItemsMock.mockResolvedValue([makeItem('p1', '海边的清晨')]);

    render(<GalleryBoard />);
    const img = (await screen.findByRole('img', { name: '海边的清晨' })) as HTMLImageElement;

    expect(img.getAttribute('src')).toBe('/thumbs/300x300/p1.jpg');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
  });

  it('灯箱使用 1600x0 大图缩略图，不请求原图', async () => {
    getItemsMock.mockResolvedValue([makeItem('p1', '海边的清晨')]);

    render(<GalleryBoard />);
    fireEvent.click(await screen.findByRole('button', { name: '查看大图：海边的清晨' }));

    const dialog = await screen.findByRole('dialog', { name: '查看大图：海边的清晨' });
    const img = dialog.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/thumbs/1600x0/p1.jpg');
    expect(img.getAttribute('decoding')).toBe('async');

    // 关键断言：没有任何一次 getPhotoUrl 不带 thumb（= 原图 URL）
    const originalCalls = getPhotoUrlMock.mock.calls.filter(([, thumb]) => !thumb);
    expect(originalCalls).toHaveLength(0);
  });

  it('多张照片时灯箱只预加载当前 ±1 张', async () => {
    getItemsMock.mockResolvedValue([
      makeItem('p1', '照片一'),
      makeItem('p2', '照片二'),
      makeItem('p3', '照片三'),
      makeItem('p4', '照片四'),
    ]);

    const preloaded: string[] = [];
    const RealImage = window.Image;
    class TrackingImage {
      decoding = 'auto';
      set src(value: string) {
        preloaded.push(value);
      }
    }
    // 只拦截灯箱的 new Image() 预加载
    (window as unknown as { Image: unknown }).Image = TrackingImage as unknown as typeof window.Image;

    try {
      render(<GalleryBoard />);
      fireEvent.click(await screen.findByRole('button', { name: '查看大图：照片二' }));
      await screen.findByRole('dialog', { name: '查看大图：照片二' });

      await waitFor(() => expect(preloaded.length).toBeGreaterThan(0));
      // 只预加载相邻的 p1 / p3，绝不碰 p4（更远）也不碰原图
      expect(preloaded).toEqual(['/thumbs/1600x0/p1.jpg', '/thumbs/1600x0/p3.jpg']);
      expect(preloaded.every((url) => url.includes('1600x0'))).toBe(true);
    } finally {
      (window as unknown as { Image: unknown }).Image = RealImage;
    }
  });
});
