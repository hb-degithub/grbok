import React from 'react';
import { motion } from 'framer-motion';

/**
 * 「登录后可评论」占位面板。
 *
 * 后端评论规则改为必须登录后，前端不再让游客看到输入框：
 * 直接给一句可读说明 + /login 入口，避免用户写完 200 字才被 403 打回。
 * 与 CommentForm / ReplyForm 共用，保持两处视觉与文案一致。
 */
export default function LoginRequiredNotice({
  title = '登录后可评论',
  description = '评论需要登录账号；登录后会自动使用你的昵称与邮箱，无需重复填写。',
}: {
  title?: string;
  description?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      data-state="login-required"
      className="flex flex-col items-center gap-3 rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-7 text-center sm:p-8"
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-[2px] border border-[var(--sf-line)] text-[var(--sf-ink-3)]">
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
          />
        </svg>
      </div>
      <h4 className="text-base font-semibold text-[var(--sf-ink)]">{title}</h4>
      <p className="max-w-sm text-sm leading-relaxed text-[var(--sf-ink-3)]">{description}</p>
      <a
        href="/login"
        className="focus-ring inline-flex min-h-11 items-center justify-center rounded-[3px] border border-[var(--sf-accent)] bg-[var(--sf-accent)] px-5 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--sf-on-accent)] no-underline transition-colors hover:border-[var(--sf-accent-ink)] hover:bg-[var(--sf-accent-ink)]"
      >
        去登录
      </a>
    </motion.div>
  );
}
