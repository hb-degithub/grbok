import React from 'react';

interface AccountLoginPromptProps {
  /** 说明为什么这个页面需要登录，默认文案覆盖通用账户场景。 */
  description?: string;
}

/**
 * 账号页未登录引导。
 *
 * 通知设置、邮箱变更等账户页都需要登录；改造前 NotificationSettings 直接
 * `return null`，页面只剩一张空卡。这里统一给出「请先登录」与 /login 入口，
 * 不引入 redirect 参数，避免改变现有登录跳转语义。
 */
export default function AccountLoginPrompt({
  description = '登录后即可继续操作。',
}: AccountLoginPromptProps) {
  return (
    <div className="flex flex-col gap-3 py-2">
      <p className="text-base font-semibold text-[var(--sf-ink)]">请先登录</p>
      <p className="text-sm leading-relaxed text-[var(--sf-ink-3)]">{description}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <a
          href="/login"
          className="focus-ring inline-flex min-h-11 items-center justify-center rounded-[3px] border border-[var(--sf-accent)] bg-[var(--sf-accent)] px-5 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--sf-on-accent)] no-underline transition-colors hover:border-[var(--sf-accent-ink)] hover:bg-[var(--sf-accent-ink)]"
        >
          前往登录
        </a>
        <a
          href="/"
          className="focus-ring inline-flex min-h-11 items-center justify-center rounded-[3px] px-2 text-sm text-[var(--sf-ink-3)] no-underline transition-colors hover:text-[var(--sf-ink)]"
        >
          返回首页
        </a>
      </div>
    </div>
  );
}
