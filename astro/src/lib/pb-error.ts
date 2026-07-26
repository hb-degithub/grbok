/**
 * PocketBase 错误统一翻译
 *
 * 后端 step-up 写保护（pb_hooks/lib/admin_step_up.js）在凭证缺失/过期时抛
 * ForbiddenError('ADMIN_STEP_UP_REQUIRED')，PocketBase JS SDK 包装为
 * ClientResponseError：err.status === 403 且 err.response.data.code === 'ADMIN_STEP_UP_REQUIRED'。
 * 字段级校验冲突（如 slug 唯一索引）返回 400：err.response.data.<field>.code === 'validation_not_unique'。
 *
 * 所有后台写操作的 catch 都应通过 describePbError 翻译错误，避免笼统误报。
 */

export type PbErrorKind = 'step_up_expired' | 'validation' | 'not_unique' | 'forbidden' | 'network' | 'unknown';

export interface PbErrorInfo {
  kind: PbErrorKind;
  message: string;
}

interface PbResponseData {
  code?: string;
  message?: string;
  [field: string]: unknown;
}

function readErr(err: unknown): { status: number; data: PbResponseData; message: string } {
  const anyErr = err as {
    status?: number;
    message?: string;
    response?: { data?: PbResponseData };
    data?: PbResponseData;
  } | null | undefined;
  return {
    status: typeof anyErr?.status === 'number' ? anyErr.status : 0,
    // PocketBase SDK：字段错误在 err.response.data；部分版本兜底 err.data
    data: anyErr?.response?.data ?? anyErr?.data ?? {},
    message: typeof anyErr?.message === 'string' ? anyErr.message : '',
  };
}

/** 是否为 step-up 二次验证过期/缺失 */
export function isStepUpRequired(err: unknown): boolean {
  const { status, data, message } = readErr(err);
  if (status !== 403) return false;
  return data?.code === 'ADMIN_STEP_UP_REQUIRED' || message.includes('ADMIN_STEP_UP_REQUIRED');
}

/** 提取字段级 validation_not_unique 冲突的字段名（如 slug） */
function notUniqueField(data: PbResponseData): string {
  for (const key of Object.keys(data)) {
    const value = data[key];
    if (value && typeof value === 'object' && (value as { code?: string }).code === 'validation_not_unique') {
      return key;
    }
  }
  return '';
}

/** 提取首个字段级校验错误信息 */
function firstFieldError(data: PbResponseData): string {
  for (const key of Object.keys(data)) {
    const value = data[key];
    if (value && typeof value === 'object') {
      const v = value as { code?: string; message?: string };
      if (v.message) return `${key}: ${v.message}`;
    }
  }
  return '';
}

/**
 * 把 PocketBase 写操作错误翻译为用户可读信息。
 * @param err      catch 到的原始错误
 * @param fallback 无法识别时的兜底文案
 */
export function describePbError(err: unknown, fallback: string): string {
  return analyzePbError(err, fallback).message;
}

export function analyzePbError(err: unknown, fallback: string): PbErrorInfo {
  const { status, data, message } = readErr(err);

  if (isStepUpRequired(err)) {
    return { kind: 'step_up_expired', message: '管理会话已过期，请在弹出的验证框中重新输入动态口令' };
  }

  if (status === 403) {
    return { kind: 'forbidden', message: data?.message || '没有执行该操作的权限' };
  }

  if (status === 400) {
    const uniqueField = notUniqueField(data);
    if (uniqueField) {
      return { kind: 'not_unique', message: `${uniqueField} 已被占用，请换一个` };
    }
    const fieldError = firstFieldError(data);
    if (fieldError) {
      return { kind: 'validation', message: `内容校验未通过（${fieldError}）` };
    }
    return { kind: 'validation', message: data?.message || '提交内容未通过校验' };
  }

  if (status === 404) {
    return { kind: 'unknown', message: '目标记录不存在或已被删除' };
  }

  if (status === 0) {
    return { kind: 'network', message: '网络异常，请检查连接后重试' };
  }

  return { kind: 'unknown', message: message || fallback };
}
