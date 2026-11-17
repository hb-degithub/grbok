import React, { useState } from 'react';
import { motion } from 'framer-motion';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { showToast } from '../ui/Toast';
import { useGuestbook } from '../../hooks/domains/useGuestbook';
import { fadeUp } from '../../lib/motion';

const NICKNAME_MAX = 30;
const CONTENT_MAX = 500;

/**
 * 多行输入与 ui/Input 保持同一套令牌：
 * 表面色 + 冷灰控制线，聚焦切到唯一强调色并画 2px 焦点环。
 */
const textareaClass =
  'min-h-[104px] w-full min-w-0 rounded-[3px] border border-[var(--sf-line-control)] bg-[var(--sf-surface)] px-3 py-2.5 text-[16px] leading-6 text-[var(--sf-ink)] placeholder:text-[var(--sf-ink-3)] transition-colors duration-200 ease-out outline-none focus-visible:border-[var(--sf-accent)] focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)] sm:px-4 sm:text-sm';

interface GuestbookFormProps {
  /** 提交成功回调：把新留言插入墙顶 */
  onPosted: (message: { id: string; nickname: string; content: string; created: string }) => void;
}

/** 留言表单：昵称 + 内容（带字数统计），前端预校验，成功后回调插入墙顶 */
export default function GuestbookForm({ onPosted }: GuestbookFormProps) {
  const [nickname, setNickname] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { postMessage } = useGuestbook();

  const trimmedNickname = nickname.trim();
  const trimmedContent = content.trim();
  const canSubmit =
    !submitting &&
    trimmedNickname.length > 0 &&
    trimmedNickname.length <= NICKNAME_MAX &&
    trimmedContent.length > 0 &&
    trimmedContent.length <= CONTENT_MAX;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const success = await postMessage({ nickname: trimmedNickname, content: trimmedContent });
      if (success) {
        showToast('留言成功，感谢你的到访！', 'success');
        setNickname('');
        setContent('');
        onPosted({ id: '', nickname: trimmedNickname, content: trimmedContent, created: new Date().toISOString() });
      } else {
        showToast('提交失败，可能是太频繁了，请稍后再试', 'error');
      }
    } catch {
      showToast('提交失败，可能是太频繁了，请稍后再试', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.form variants={fadeUp} initial="hidden" animate="visible" onSubmit={handleSubmit} noValidate
      className="rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-5 sm:p-6">
      <div className="border-b border-[var(--sf-line)] pb-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--sf-ink-3)]">Guestbook / write</p>
        <h2 className="mt-1 text-lg font-semibold tracking-tight text-[var(--sf-ink)]">写下留言</h2>
        <p className="mt-1 text-xs text-[var(--sf-ink-3)]">匿名留言，昵称会公开展示</p>
      </div>
      <div className="mt-4 grid gap-4">
        <Input
          label="昵称"
          placeholder="你的昵称（30 字以内）"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          maxLength={NICKNAME_MAX + 10}
          helperText={`${trimmedNickname.length}/${NICKNAME_MAX}`}
          required
          autoComplete="name"
        />
        <div>
          <label htmlFor="guestbook-content" className="mb-1.5 block break-words text-sm font-medium leading-snug text-[var(--sf-ink-2)]">
            留言内容
          </label>
          <textarea
            id="guestbook-content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="说点什么吧…（500 字以内）"
            rows={4}
            maxLength={CONTENT_MAX + 50}
            required
            className={textareaClass}
          />
          <div className="mt-1 flex justify-end font-mono text-[11px] text-[var(--sf-ink-3)]">
            {trimmedContent.length}/{CONTENT_MAX}
          </div>
        </div>
        <div>
          <Button type="submit" variant="primary" size="lg" loading={submitting} disabled={!canSubmit}>
            发布留言
          </Button>
        </div>
      </div>
    </motion.form>
  );
}
