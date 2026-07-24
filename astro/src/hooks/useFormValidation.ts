import { useState, useCallback, useRef } from 'react';

/**
 * 通用表单校验 hook —— 提供给评论/留言/回复等用户输入表单复用。
 *
 * 现有 CommentForm / ReplyForm / GuestbookForm 各自内联了校验逻辑，
 * 此 hook 作为可选的统一入口，不强制现有组件迁移（遵守资产保全协议）。
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ValidationRule {
  /** 字段名（对应表单 data 的 key） */
  field: string;
  /** 显示标签（用于错误信息） */
  label: string;
  required?: boolean;
  maxLength?: number;
  isEmail?: boolean;
}

export function useFormValidation<T extends Record<string, string>>(
  rules: ValidationRule[]
) {
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({});

  // 用 ref 缓存最新 rules，避免内联数组导致 useCallback 无限重建。
  // 调用方传 `[{...}]` 内联数组时不会触发 validate 函数引用变化。
  const rulesRef = useRef(rules);
  rulesRef.current = rules;

  const validate = useCallback(
    (data: T): boolean => {
      const next: Partial<Record<keyof T, string>> = {};
      let valid = true;

      for (const rule of rulesRef.current) {
        const raw = data[rule.field];
        const value = typeof raw === 'string' ? raw.trim() : String(raw || '').trim();

        if (rule.required && !value) {
          next[rule.field as keyof T] = `${rule.label}不能为空`;
          valid = false;
          continue;
        }
        if (rule.isEmail && value && !EMAIL_RE.test(value)) {
          next[rule.field as keyof T] = '邮箱格式不正确';
          valid = false;
          continue;
        }
        if (rule.maxLength && value.length > rule.maxLength) {
          next[rule.field as keyof T] = `${rule.label}不超过 ${rule.maxLength} 字`;
          valid = false;
        }
      }

      setErrors(next);
      return valid;
    },
    []
  );

  const clearField = useCallback((field: keyof T) => {
    setErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const clearAll = useCallback(() => setErrors({}), []);

  return { errors, validate, clearField, clearAll };
}
