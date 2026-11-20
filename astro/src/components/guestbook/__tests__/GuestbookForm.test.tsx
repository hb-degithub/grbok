import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * 留言表单契约：保留真实提交路径（postMessage）、trim 与成功回调。
 * 本次视觉重构不得顺手改掉提交参数或清空逻辑。
 */

const { postMessageMock } = vi.hoisted(() => ({ postMessageMock: vi.fn() }));

vi.mock('../../../hooks/domains/useGuestbook', () => ({
  useGuestbook: () => ({ postMessage: postMessageMock }),
}));

import GuestbookForm from '../GuestbookForm';

beforeEach(() => {
  postMessageMock.mockReset();
});

afterEach(cleanup);

describe('GuestbookForm · 提交路径', () => {
  it('提交 trim 后的昵称与内容，并在成功后回调', async () => {
    postMessageMock.mockResolvedValue(true);
    const onPosted = vi.fn();

    render(<GuestbookForm onPosted={onPosted} />);

    fireEvent.change(screen.getByLabelText('昵称'), { target: { value: '  HB  ' } });
    fireEvent.change(screen.getByPlaceholderText(/说点什么吧/), { target: { value: '  你好，轨道日志  ' } });
    fireEvent.click(screen.getByRole('button', { name: '发布留言' }));

    await waitFor(() =>
      expect(postMessageMock).toHaveBeenCalledWith({ nickname: 'HB', content: '你好，轨道日志' }),
    );
    await waitFor(() => expect(onPosted).toHaveBeenCalledTimes(1));
  });

  it('提交失败不触发成功回调，表单内容保留', async () => {
    postMessageMock.mockResolvedValue(false);
    const onPosted = vi.fn();

    render(<GuestbookForm onPosted={onPosted} />);

    fireEvent.change(screen.getByLabelText('昵称'), { target: { value: 'HB' } });
    fireEvent.change(screen.getByPlaceholderText(/说点什么吧/), { target: { value: '再说一次' } });
    fireEvent.click(screen.getByRole('button', { name: '发布留言' }));

    await waitFor(() => expect(postMessageMock).toHaveBeenCalledTimes(1));
    expect(onPosted).not.toHaveBeenCalled();
    expect((screen.getByPlaceholderText(/说点什么吧/) as HTMLTextAreaElement).value).toBe('再说一次');
  });
});
