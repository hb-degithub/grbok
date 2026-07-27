import React, { useState } from 'react';
import { motion } from 'framer-motion';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { showToast } from '../ui/Toast';
import { useGuestbook } from '../../hooks/domains/useGuestbook';
import { fadeUp } from '../../lib/motion';

const NICKNAME_MAX = 30;
const CONTENT_MAX = 500;

const textareaClass =
  'w-full rounded-xl border border-zinc-200 bg-white/70 px-4 py-3 text-sm text-zinc-900 placeholder-zinc-400 transition-all duration-200 ease-out outline-none focus-visible:border-teal-500 focus-visible:ring-2 focus-visible:ring-teal-500/35 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus-visible:border-teal-400';

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
      className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xl shadow-zinc-900/[0.04] dark:border-zinc-800 dark:bg-zinc-900 sm:p-6">
      <h2 className="text-sm font-black tracking-tight text-zinc-950 dark:text-zinc-50">写下留言</h2>
      <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">匿名留言，昵称会公开展示</p>
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
          <label htmlFor="guestbook-content" className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
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
          <div className="mt-1 text-right text-[11px] text-zinc-400 dark:text-zinc-500">
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
