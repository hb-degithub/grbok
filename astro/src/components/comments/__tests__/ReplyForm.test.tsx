import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * 回复表单行为契约（阅读路径 · 评论体验）。
 *
 * 关注用户可见结果：
 *   1. 回复结果写入常驻 live region（提交中/成功），失败文案只由内联 alert
 *      播报一次，避免 polite + alert 双播报；
 *   2. 失败文案取本次返回的 error，而不是旧 serverError prop；
 *   3. 打开回复框后焦点进入内容框，Esc/取消关闭后把焦点还给回复按钮，
 *      并把 status 重置为 idle（再次打开不残留上一次错误）；
 *   4. 多个回复框同时存在时，昵称/邮箱 Input 的 id 不冲突；
 *   5. 提交携带正确 parent_id，成功后自动收起，失败时保留内容。
 */

const limiter = vi.hoisted(() => ({ allow: true }));

vi.mock('../../../lib/security', () => ({
  RateLimiter: class {
    tryConsume() {
      return limiter.allow;
    }
  },
}));

const auth = vi.hoisted(() => ({
  isAuthenticated: vi.fn(() => false),
  getCurrentUser: vi.fn(() => null),
  onAuthChange: vi.fn(() => () => {}),
  getUserEmail: vi.fn(() => null as string | null),
}));

vi.mock('../../../lib/services/authService', () => ({ authService: auth }));

import ReplyForm from '../ReplyForm';

const liveRegion = () => screen.getByRole('status');
const liveText = () => liveRegion().textContent ?? '';
const alertText = () => screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

function fillReply({ name = '读者', content = '回复一句' } = {}) {
  fireEvent.change(screen.getByLabelText('昵称'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('回复内容'), { target: { value: content } });
}

beforeEach(() => {
  limiter.allow = true;
  cleanup();
});

afterEach(cleanup);

describe('ReplyForm · 打开与焦点', () => {
  it('isOpen=false 时不渲染表单', () => {
    render(<ReplyForm isOpen={false} onClose={vi.fn()} onSubmit={vi.fn()} parentId="c1" />);
    expect(screen.queryByLabelText('回复内容')).toBeNull();
  });

  it('打开后焦点进入回复内容框', async () => {
    render(<ReplyForm isOpen onClose={vi.fn()} onSubmit={vi.fn()} parentId="c1" />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('回复内容')));
  });

  it('Esc 关闭回复框', () => {
    const onClose = vi.fn();
    render(<ReplyForm isOpen onClose={onClose} onSubmit={vi.fn()} parentId="c1" />);

    fireEvent.keyDown(screen.getByLabelText('回复内容'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc/取消关闭后把焦点还给回复按钮', () => {
    const triggerRef = React.createRef<HTMLButtonElement>();
    const onClose = vi.fn();
    render(
      <div>
        <button ref={triggerRef} type="button">回复</button>
        <ReplyForm isOpen onClose={onClose} onSubmit={vi.fn()} parentId="c1" triggerRef={triggerRef} />
      </div>
    );

    fireEvent.keyDown(screen.getByLabelText('回复内容'), { key: 'Escape' });
    expect(document.activeElement).toBe(triggerRef.current);

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(triggerRef.current);
  });

  it('关闭后重置 status：再次打开不残留上一次错误', async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn().mockResolvedValue({ success: false, error: '服务端错误' });
    const { rerender } = render(
      <ReplyForm isOpen onClose={onClose} onSubmit={onSubmit} parentId="c1" />
    );

    fillReply();
    fireEvent.click(screen.getByRole('button', { name: '发送回复' }));
    await waitFor(() => expect(alertText()).toContain('服务端错误'));

    fireEvent.keyDown(screen.getByLabelText('回复内容'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<ReplyForm isOpen={false} onClose={onClose} onSubmit={onSubmit} parentId="c1" />);
    rerender(<ReplyForm isOpen onClose={onClose} onSubmit={onSubmit} parentId="c1" />);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('服务端错误')).toBeNull();
    expect(liveText()).not.toContain('服务端错误');
  });
});

describe('ReplyForm · 提交反馈', () => {
  it('成功时播报审核提示、携带 parent_id 并自动收起', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();
    render(<ReplyForm isOpen onClose={onClose} onSubmit={onSubmit} parentId="c1" moderationEnabled />);

    fillReply();
    fireEvent.click(screen.getByRole('button', { name: '发送回复' }));

    await waitFor(() => expect(liveText()).toContain('回复已提交，审核后展示'));
    expect(onSubmit).toHaveBeenCalledWith({
      author_name: '读者',
      author_email: '',
      content: '回复一句',
      parent_id: 'c1',
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 4000 });
  });

  it('失败时由内联 alert 播报服务端文案，表单与内容保留', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ success: false, error: '请先验证你的邮箱后再发表评论' });
    render(<ReplyForm isOpen onClose={vi.fn()} onSubmit={onSubmit} parentId="c1" />);

    fillReply();
    fireEvent.click(screen.getByRole('button', { name: '发送回复' }));

    await waitFor(() => expect(alertText()).toContain('请先验证你的邮箱后再发表评论'));
    expect(liveText()).not.toContain('请先验证你的邮箱后再发表评论');
    expect((screen.getByLabelText('回复内容') as HTMLTextAreaElement).value).toBe('回复一句');
  });

  it('失败文案取本次返回的 error，而不是旧 serverError prop', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ success: false, error: '本次失败：邮箱未验证' });
    render(
      <ReplyForm isOpen onClose={vi.fn()} onSubmit={onSubmit} parentId="c1" serverError="上一次的旧错误" />
    );

    fillReply();
    fireEvent.click(screen.getByRole('button', { name: '发送回复' }));

    await waitFor(() => expect(alertText()).toContain('本次失败：邮箱未验证'));
    expect(alertText()).not.toContain('上一次的旧错误');
  });

  it('空昵称/空内容：不提交并给出字段级错误', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<ReplyForm isOpen onClose={vi.fn()} onSubmit={onSubmit} parentId="c1" />);

    fireEvent.click(screen.getByRole('button', { name: '发送回复' }));

    await waitFor(() => expect(alertText()).toContain('请填写昵称和回复内容'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText('昵称').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('回复内容').getAttribute('aria-invalid')).toBe('true');
  });

  it('提交中取消：迟到的结果不会在下一次展开时残留', async () => {
    let resolveSubmit!: (value: boolean | { success: boolean; error: string }) => void;
    const onSubmit = vi.fn(
      () =>
        new Promise<boolean | { success: boolean; error: string }>((resolve) => {
          resolveSubmit = resolve;
        })
    );
    const onClose = vi.fn();
    const { rerender } = render(
      <ReplyForm isOpen onClose={onClose} onSubmit={onSubmit} parentId="c1" />
    );

    fillReply();
    fireEvent.click(screen.getByRole('button', { name: '发送回复' }));

    fireEvent.keyDown(screen.getByLabelText('回复内容'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<ReplyForm isOpen={false} onClose={onClose} onSubmit={onSubmit} parentId="c1" />);
    rerender(<ReplyForm isOpen onClose={onClose} onSubmit={onSubmit} parentId="c1" />);

    // 取消后才返回的失败结果必须被丢弃
    await act(async () => {
      resolveSubmit({ success: false, error: '迟到的服务端错误' });
    });

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('迟到的服务端错误')).toBeNull();
    expect(liveText()).not.toContain('迟到的服务端错误');
  });

  it('多个回复框同时打开时 Input 的 id 不冲突', () => {
    render(
      <div>
        <ReplyForm isOpen onClose={vi.fn()} onSubmit={vi.fn()} parentId="c1" />
        <ReplyForm isOpen onClose={vi.fn()} onSubmit={vi.fn()} parentId="c2" />
      </div>
    );

    const ids = Array.from(document.querySelectorAll('input')).map((el) => el.id);
    expect(ids.filter(Boolean)).toHaveLength(ids.length);
    expect(new Set(ids).size).toBe(ids.length);
    expect(screen.getAllByLabelText('昵称')).toHaveLength(2);
    expect(screen.getAllByLabelText('回复内容')).toHaveLength(2);
  });
});
