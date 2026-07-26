/**
 * step-up 会话恢复管理器
 *
 * 后台写操作被服务端 step-up 写保护拒绝（403 ADMIN_STEP_UP_REQUIRED）时，
 * 通过事件总线通知 AdminGuard 挂载的内联 TOTP 重验模态，验证成功后
 * 调用方自动重放原请求——避免手动刷新页面丢失编辑器内容。
 */

import { isStepUpRequired } from './pb-error';

const STEP_UP_EVENT = 'blog:admin-step-up-required';

/** 写操作 catch 中调用：若是 step-up 过期则广播事件并返回 true（调用方应据此提示） */
export function notifyStepUpExpired(err: unknown): boolean {
  if (!isStepUpRequired(err)) return false;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(STEP_UP_EVENT));
  }
  return true;
}

export function onStepUpRequired(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = () => handler();
  window.addEventListener(STEP_UP_EVENT, listener);
  return () => window.removeEventListener(STEP_UP_EVENT, listener);
}
