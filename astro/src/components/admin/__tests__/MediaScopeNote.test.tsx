import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * 媒体库 / 相册管理的边界说明。
 *
 * 两个入口容易混：媒体库是文章封面/正文插图的素材仓库，不对外展示；
 * 相册管理是 /gallery 的对外照片墙。页面顶部说明必须写明区别并给出互相跳转。
 */

const { mediaState } = vi.hoisted(() => ({
  mediaState: { current: {} as Record<string, unknown> },
}));

vi.mock('../../../hooks/domains/useMediaLibrary', () => ({
  useMediaLibrary: () => mediaState.current,
}));

vi.mock('../../../hooks/useAdminAuth', () => ({
  useAdminAuth: () => ({ user: { id: 'me', role: 'super_admin' }, role: 'super_admin' }),
}));

import MediaLibrary from '../MediaLibrary';
import MediaScopeNote from '../MediaScopeNote';

function baseMediaState(over: Record<string, unknown> = {}) {
  return {
    assets: [],
    loading: false,
    uploading: false,
    uploadProgress: null,
    fileInputRef: { current: null },
    deleteAsset: vi.fn(),
    getFileUrl: vi.fn(() => ''),
    triggerFileInput: vi.fn(),
    handleFileChange: vi.fn(),
    ...over,
  };
}

afterEach(cleanup);

describe('MediaScopeNote', () => {
  it('媒体库说明：素材仓库、不直接对外展示，链接去相册管理', () => {
    render(<MediaScopeNote kind="library" />);

    expect(screen.getByText('媒体库：')).toBeTruthy();
    expect(screen.getByText(/文章 \/ 封面用的素材仓库，不直接对外展示/)).toBeTruthy();
    const link = screen.getByRole('link', { name: /去相册管理/ });
    expect(link.getAttribute('href')).toBe('/admin/gallery');
  });

  it('相册管理说明：对外照片墙，缺素材去媒体库上传', () => {
    render(<MediaScopeNote kind="gallery" />);

    expect(screen.getByText('相册管理：')).toBeTruthy();
    expect(screen.getByText(/展示在 \/gallery 的对外照片墙/)).toBeTruthy();
    const link = screen.getByRole('link', { name: /去媒体库上传/ });
    expect(link.getAttribute('href')).toBe('/admin/media');
  });
});

describe('MediaLibrary · 页面顶部说明', () => {
  it('独立页面展示说明与去相册管理的链接', () => {
    mediaState.current = baseMediaState();
    render(<MediaLibrary />);

    expect(screen.getByText(/文章 \/ 封面用的素材仓库/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /去相册管理/ }).getAttribute('href')).toBe('/admin/gallery');
  });

  it('作为文章编辑器内的素材选择器时隐藏说明，避免干扰选图', () => {
    mediaState.current = baseMediaState();
    render(<MediaLibrary onSelect={vi.fn()} onClose={vi.fn()} />);

    expect(screen.queryByText(/文章 \/ 封面用的素材仓库/)).toBeNull();
    expect(screen.queryByRole('link', { name: /去相册管理/ })).toBeNull();
  });
});
