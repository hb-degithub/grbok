import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * 后台侧栏：媒体库 / 相册管理的入口区分。
 * 「媒体」改名为「媒体库」，并给两个入口各一行说明，避免用户把素材仓库当成对外相册。
 */

vi.mock('../../../hooks/useAdminAuth', () => ({
  useAdminAuth: () => ({
    hasPermission: () => true,
    user: { name: 'HB', email: 'hb@example.com', role: 'super_admin' },
  }),
  useAdminLogout: () => ({ logout: vi.fn() }),
}));

vi.mock('../../../hooks/useBreakpoint', () => ({
  default: () => ({ isDesktop: true }),
}));

import AdminSidebar from '../AdminSidebar';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(cleanup);

describe('AdminSidebar · 媒体库与相册管理', () => {
  it('显示「媒体库」并说明它是素材仓库（文章封面、正文插图）', () => {
    render(<AdminSidebar />);

    expect(screen.getByText('媒体库')).toBeTruthy();
    expect(screen.getByText('素材仓库：文章封面、正文插图')).toBeTruthy();
    // 旧文案「媒体」不再单独出现
    expect(screen.queryByText('媒体')).toBeNull();
  });

  it('「相册管理」说明它是对外展示的照片墙', () => {
    render(<AdminSidebar />);

    expect(screen.getByText('相册管理')).toBeTruthy();
    expect(screen.getByText('对外展示的照片墙')).toBeTruthy();
  });

  it('两个入口的跳转地址保持不变', () => {
    render(<AdminSidebar />);

    const mediaLink = screen.getByText('媒体库').closest('a');
    const galleryLink = screen.getByText('相册管理').closest('a');
    expect(mediaLink?.getAttribute('href')).toBe('/admin/media');
    expect(galleryLink?.getAttribute('href')).toBe('/admin/gallery');
  });
});
