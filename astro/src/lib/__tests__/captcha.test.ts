import { describe, expect, it } from 'vitest';
import {
  CAPTCHA_ERROR_CODES,
  CAPTCHA_ERROR_MESSAGES,
  captchaErrorCode,
  captchaErrorMessage,
  isCaptchaError,
  isCaptchaErrorCode,
} from '../captcha';

/**
 * ALTCHA 服务端错误码 → 中文提示的解析契约。
 *
 * 服务端（并行任务）在 400/503 时返回 `{ code: 'CAPTCHA_*' }`；
 * PocketBase SDK 会把它包成 `ClientResponseError`（响应体在 `response`），
 * `pb.send` 的部分路径又套一层 `data`。这里锁死「各种包装都能取到 code」，
 * 以及「非 CAPTCHA 错误必须返回 null，交回原有兜底文案」。
 */
describe('captcha 错误码映射', () => {
  it('五种错误码都有中文提示', () => {
    expect([...CAPTCHA_ERROR_CODES].sort()).toEqual([
      'CAPTCHA_EXPIRED',
      'CAPTCHA_INVALID',
      'CAPTCHA_REPLAY',
      'CAPTCHA_REQUIRED',
      'CAPTCHA_UNCONFIGURED',
    ]);
    for (const code of CAPTCHA_ERROR_CODES) {
      expect(CAPTCHA_ERROR_MESSAGES[code], `${code} 缺少中文提示`).toBeTruthy();
    }
    expect(CAPTCHA_ERROR_MESSAGES.CAPTCHA_REQUIRED).toBe('请先完成人机验证后再提交');
    expect(CAPTCHA_ERROR_MESSAGES.CAPTCHA_EXPIRED).toBe('验证已过期，请重新验证');
  });

  it('从 PocketBase ClientResponseError 的 response 里取出错误码', () => {
    const err = Object.assign(new Error('Bad Request'), {
      status: 400,
      response: { code: 'CAPTCHA_INVALID', message: 'bad' },
    });
    expect(captchaErrorCode(err)).toBe('CAPTCHA_INVALID');
    expect(isCaptchaError(err)).toBe(true);
    expect(captchaErrorMessage(err)).toBe('人机验证未通过，请重新验证');
  });

  it('兼容 response.data / data / 顶层 code 三种包装', () => {
    expect(captchaErrorCode({ response: { data: { code: 'CAPTCHA_EXPIRED' } } })).toBe('CAPTCHA_EXPIRED');
    expect(captchaErrorCode({ data: { code: 'CAPTCHA_REPLAY' } })).toBe('CAPTCHA_REPLAY');
    expect(captchaErrorCode({ code: 'CAPTCHA_REQUIRED' })).toBe('CAPTCHA_REQUIRED');
  });

  it('503 CAPTCHA_UNCONFIGURED 也按 CAPTCHA 错误处理', () => {
    const err = { status: 503, response: { code: 'CAPTCHA_UNCONFIGURED' } };
    expect(captchaErrorMessage(err)).toBe('人机验证服务暂不可用，请稍后重试');
  });

  it('非 CAPTCHA 错误返回 null，不抢占原有兜底文案', () => {
    expect(captchaErrorCode(null)).toBeNull();
    expect(captchaErrorCode(undefined)).toBeNull();
    expect(captchaErrorCode('oops')).toBeNull();
    expect(captchaErrorCode(new Error('network'))).toBeNull();
    expect(captchaErrorMessage({ status: 400, response: { code: 'EMAIL_RATE_LIMITED' } })).toBeNull();
    expect(isCaptchaError({ response: { code: 'SOMETHING_ELSE' } })).toBe(false);
  });

  it('嵌套过深时不会无限递归', () => {
    let deep: Record<string, unknown> = { code: 'CAPTCHA_REQUIRED' };
    for (let i = 0; i < 12; i += 1) deep = { data: deep };
    expect(captchaErrorCode(deep)).toBeNull();
  });

  it('isCaptchaErrorCode 只认已知常量', () => {
    expect(isCaptchaErrorCode('CAPTCHA_REQUIRED')).toBe(true);
    expect(isCaptchaErrorCode('captcha_required')).toBe(false);
    expect(isCaptchaErrorCode(400)).toBe(false);
  });
});
