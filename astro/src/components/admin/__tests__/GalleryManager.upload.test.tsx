import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * 相册后台上传进度的渲染契约。
 *
 * 上传链路换成 XMLHttpRequest 后，进度来自 `xhr.upload.onprogress`；
 * useGallery 把它收敛成 `uploadState`，这里验证界面把「文件名 + 百分比」真实画出来，
 * 压缩阶段则显示不可量化的「压缩中」而不是假的百分比。
 */

const { galleryState } = vi.hoisted(() => ({
  galleryState: { current: {} as Record<string, unknown> },
}));

vi.mock('../../../hooks/domains/useGallery', () => ({
  useGallery: () => galleryState.current,
}));

vi.mock('../../../hooks/useAdminAuth', () => ({
  useAdminAuth: () => ({ user: { role: 'super_admin', email: 'admin@example.com' } }),
}));

import GalleryManager from '../GalleryManager';

function baseState(over: Record<string, unknown> = {}) {
  return {
    items: [],
    loading: false,
    error: '',
    status: '',
    filter: '',
    uploading: false,
    uploadState: { stage: 'idle', percent: 0, fileName: '', originalBytes: 0, compressedBytes: 0 },
    setFilter: vi.fn(),
    setError: vi.fn(),
    setStatus: vi.fn(),
    load: vi.fn(async () => {}),
    toggleStatus: vi.fn(),
    remove: vi.fn(),
    upload: vi.fn(),
    getPhotoUrl: vi.fn(() => ''),
    ...over,
  };
}

afterEach(cleanup);

describe('GalleryManager · 上传进度', () => {
  it('传输阶段显示文件名与百分比进度条', () => {
    galleryState.current = baseState({
      uploading: true,
      uploadState: {
        stage: 'uploading',
        percent: 42,
        fileName: 'sea.jpg',
        originalBytes: 9.7 * 1024 * 1024,
        compressedBytes: 850 * 1024,
      },
    });

    render(<GalleryManager />);

    const bar = screen.getByRole('progressbar', { name: '上传进度' });
    expect(bar.getAttribute('aria-valuenow')).toBe('42');
    expect(screen.getByText(/正在上传 sea\.jpg/)).toBeTruthy();
    expect(screen.getByText('42%')).toBeTruthy();
    // 压缩收益可见：9.7 MB → 850 KB
    expect(screen.getByText('已压缩 9.7 MB → 850 KB')).toBeTruthy();
  });

  it('压缩阶段不谎报百分比，显示「压缩中」', () => {
    galleryState.current = baseState({
      uploading: true,
      uploadState: {
        stage: 'compressing',
        percent: 0,
        fileName: 'big.png',
        originalBytes: 9 * 1024 * 1024,
        compressedBytes: 0,
      },
    });

    render(<GalleryManager />);

    const bar = screen.getByRole('progressbar', { name: '上传进度' });
    expect(bar.getAttribute('aria-valuenow')).toBeNull();
    expect(bar.getAttribute('aria-valuetext')).toBe('正在压缩图片');
    expect(screen.getByText(/正在压缩 big\.png/)).toBeTruthy();
    expect(screen.getByText('压缩中')).toBeTruthy();
  });

  it('非上传状态不渲染进度条', () => {
    galleryState.current = baseState();

    render(<GalleryManager />);

    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText(/正在上传/)).toBeNull();
  });
});
