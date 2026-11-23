import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * 评论区「重新发送验证邮件」× ALTCHA 人机验证。
 *
 * 评论区只有这一个动作会触发邮件（登录用户未验证邮箱时的重发入口），
 * 因此人机验证只挂在这里；普通评论提交（onSubmit）不受影响。
 */

const altcha = vi.hoisted(() => ({
  status: 'pending' as 'pending' | 'blocked' | 'verified' | 'unavailable',
  payload: null as string | null,
  reset: vi.fn(),
}));

const mail = vi.hoisted(() => ({
  requestVerification: vi.fn(),
}));

const auth = vi.hoisted(() => ({
  isAuthenticated: vi.fn(() => true),
  getCurrentUser: vi.fn(() => ({ id: 'u1', name: '读者', email: 'reader@example.com' })),
  onAuthChange: vi.fn(() => () => {}),
  getUserEmail: vi.fn(() => 'reader@example.com'),
}));

vi.mock('../../auth/AltchaField', async () => {
  const React = await import('react');
  const MockAltchaField = React.forwardRef(function MockAltchaField(
    props: { onVerified?: (payload: string | null) => void; onStatusChange?: (status: string) => void },
    ref: React.Ref<unknown>,
  ) {
    React.useImperativeHandle(ref, () => ({ reset: altcha.reset }));
    React.useEffect(() => {
      props.onStatusChange?.(altcha.status);
      props.onVerified?.(altcha.status === 'verified' ? altcha.payload : null);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return null;
  });
  return { __esModule: true, default: MockAltchaField };
});

vi.mock('../../../lib/blog-auth-client', () => ({
  requestVerification: mail.requestVerification,
}));

vi.mock('../../../lib/services/authService', () => ({ authService: auth }));

import CommentForm from '../CommentForm';

function renderUnverifiedForm() {
  return render(<CommentForm postId="post-1" onSubmit={vi.fn()} userEmailVerified={false} />);
}

function resendButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: '重新发送验证邮件' }) as HTMLButtonElement;
}

beforeEach(() => {
  altcha.status = 'pending';
  altcha.payload = null;
  altcha.reset.mockClear();
  mail.requestVerification.mockReset();
  mail.requestVerification.mockResolvedValue({ accepted: true });
});

afterEach(cleanup);

describe('CommentForm × ALTCHA（重发验证邮件）', () => {
  it('未验证时禁用重发按钮，且不触发邮件请求', () => {
    altcha.status = 'blocked';
    renderUnverifiedForm();

    expect(resendButton().disabled).toBe(true);

    fireEvent.click(resendButton());
    expect(mail.requestVerification).not.toHaveBeenCalled();
    expect(screen.queryByText('验证邮件已发送，请检查收件箱')).toBeNull();
  });

  it('已验证时 payload 随重发请求发送，成功后提示并重置 widget', async () => {
    altcha.status = 'verified';
    altcha.payload = 'cGF5bG9hZA==';
    renderUnverifiedForm();

    expect(resendButton().disabled).toBe(false);
    fireEvent.click(resendButton());

    await waitFor(() => {
      expect(mail.requestVerification).toHaveBeenCalledWith('reader@example.com', 'cGF5bG9hZA==');
    });
    await waitFor(() => expect(screen.getByText('验证邮件已发送，请检查收件箱')).toBeTruthy());
    expect(altcha.reset).toHaveBeenCalled();
  });

  it('服务端返回 CAPTCHA_INVALID：内联 alert 提示并重新取挑战', async () => {
    altcha.status = 'verified';
    altcha.payload = 'cGF5bG9hZA==';
    mail.requestVerification.mockRejectedValueOnce({ status: 400, response: { code: 'CAPTCHA_INVALID' } });

    renderUnverifiedForm();
    fireEvent.click(resendButton());

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('人机验证未通过，请重新验证');
    });
    expect(altcha.reset).toHaveBeenCalled();
    // 失败后按钮回到可再次尝试的状态
    expect(resendButton().disabled).toBe(false);
  });

  it('非 CAPTCHA 错误保留「发送失败」兜底文案，且不重置 widget', async () => {
    altcha.status = 'verified';
    altcha.payload = 'cGF5bG9hZA==';
    mail.requestVerification.mockRejectedValueOnce(new Error('smtp down'));

    renderUnverifiedForm();
    fireEvent.click(resendButton());

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('发送失败，请稍后重试');
    });
    expect(altcha.reset).not.toHaveBeenCalled();
  });
});
