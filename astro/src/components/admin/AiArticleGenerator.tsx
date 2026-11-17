import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAiAssist } from '../../hooks/domains/useAiAssist';
import type { AiArticleLength } from '../../lib/services/aiAssistService';
import { showToast } from '../ui/Toast';
import { cn } from '../../lib/utils';

/* AI 生成文章弹窗（科幻简约 · 批次 C5）
   遮罩走 --sf-scrim，面板实底 surface + 细线，桌面端圆角 3px、移动端保持全屏。
   输入与 ui/Input.tsx 一致；篇幅选择为细线分段控件，选中强调色实底 + on-accent。
   生成、Toast、失败保留表单内容、关闭清空等逻辑完全不变。 */

interface AiArticleGeneratorProps {
  open: boolean;
  onClose: () => void;
  onCreated: (post: { id: string }) => void;
}

const LENGTH_OPTIONS: { value: AiArticleLength; label: string; hint: string }[] = [
  { value: 'short', label: '短', hint: '~800 字' },
  { value: 'medium', label: '中', hint: '~1500 字' },
  { value: 'long', label: '长', hint: '~2500 字' },
];

const inputClass =
  'min-h-[40px] w-full min-w-0 rounded-[3px] border border-[var(--sf-line-control)] bg-[var(--sf-surface)] px-3 py-2.5 text-[16px] leading-snug text-[var(--sf-ink)] outline-none transition-colors placeholder:text-[var(--sf-ink-3)] focus-visible:border-[var(--sf-accent)] focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)] disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm';
const labelClass = 'mb-1.5 block font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--sf-ink-3)]';

const BTN_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-[3px] border font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)] disabled:cursor-not-allowed disabled:opacity-50';
const BTN_PRIMARY = 'border-[var(--sf-accent)] bg-[var(--sf-accent)] text-[var(--sf-on-accent)] hover:border-[var(--sf-accent-ink)] hover:bg-[var(--sf-accent-ink)]';
const BTN_GHOST = 'border-transparent bg-transparent text-[var(--sf-ink-2)] hover:border-[var(--sf-line)] hover:bg-[var(--sf-line-soft)] hover:text-[var(--sf-ink)]';

export default function AiArticleGenerator({ open, onClose, onCreated }: AiArticleGeneratorProps) {
  const { generating, runArticle } = useAiAssist();
  const [topic, setTopic] = useState('');
  const [outline, setOutline] = useState('');
  const [style, setStyle] = useState('');
  const [length, setLength] = useState<AiArticleLength>('medium');

  // 关闭后重置，避免下次打开残留上一次的输入
  useEffect(() => {
    if (!open) {
      setTopic('');
      setOutline('');
      setStyle('');
      setLength('medium');
    }
  }, [open]);

  const handleGenerate = async () => {
    if (!topic.trim()) {
      showToast('请填写文章主题', 'error');
      return;
    }
    try {
      const post = await runArticle({ topic, outline, style, length });
      showToast(post.status === 'published' ? '已生成并发布' : '已生成草稿', 'success');
      onCreated({ id: post.id });
      onClose();
    } catch (err) {
      // 失败保留表单内容，便于微调主题后重试
      showToast(err instanceof Error ? err.message : 'AI 生成失败', 'error');
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-stretch justify-center overflow-y-auto bg-[var(--sf-scrim)] p-0 sm:items-center sm:p-4"
          onClick={() => { if (!generating) onClose(); }}
        >
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-article-dialog-title"
            className="flex min-h-[var(--vvh,100dvh)] w-full max-w-lg flex-col overflow-hidden rounded-none border border-[var(--sf-line)] bg-[var(--sf-surface)] p-5 sm:min-h-0 sm:rounded-[3px] sm:p-6"
          >
            <h2 id="ai-article-dialog-title" className="mb-6 font-display text-lg font-bold uppercase tracking-wide text-[var(--sf-ink)]">
              AI 生成文章
            </h2>

            <div className="space-y-4">
              <div>
                <label htmlFor="ai-article-topic" className={labelClass}>主题 *</label>
                <input
                  id="ai-article-topic"
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  disabled={generating}
                  placeholder="例如：Astro 岛屿架构的按需水合原理"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="ai-article-outline" className={labelClass}>大纲</label>
                <textarea
                  id="ai-article-outline"
                  value={outline}
                  onChange={(e) => setOutline(e.target.value)}
                  disabled={generating}
                  rows={4}
                  placeholder="可选。分点列出希望覆盖的内容，留空由 AI 自行组织"
                  className={cn(inputClass, 'font-mono')}
                />
              </div>
              <div>
                <label htmlFor="ai-article-style" className={labelClass}>风格</label>
                <input
                  id="ai-article-style"
                  type="text"
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  disabled={generating}
                  placeholder="技术教程/随笔/评测"
                  className={inputClass}
                />
              </div>
              <div>
                <label id="ai-article-length-label" className={labelClass}>篇幅</label>
                <div className="flex flex-wrap gap-2" role="group" aria-labelledby="ai-article-length-label">
                  {LENGTH_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      disabled={generating}
                      onClick={() => setLength(option.value)}
                      aria-pressed={length === option.value}
                      className={cn(
                        'min-h-9 rounded-[3px] border px-3 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)] disabled:cursor-not-allowed disabled:opacity-60',
                        length === option.value
                          ? 'border-[var(--sf-accent)] bg-[var(--sf-accent)] text-[var(--sf-on-accent)]'
                          : 'border-[var(--sf-line)] bg-[var(--sf-surface)] text-[var(--sf-ink-2)] hover:border-[var(--sf-line-strong)] hover:text-[var(--sf-ink)]'
                      )}
                    >
                      {option.label} · {option.hint}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {generating && (
              <div className="mt-5 rounded-[3px] border border-[var(--sf-accent)] px-4 py-3 text-xs text-[var(--sf-accent)]">
                AI 生成中，通常需要 30-90 秒，请勿关闭…
              </div>
            )}

            <div className="mt-6 flex flex-col-reverse gap-2 border-t border-[var(--sf-line)] pt-4 sm:flex-row sm:justify-end">
              <button
                onClick={onClose}
                disabled={generating}
                className={cn(BTN_BASE, BTN_GHOST, 'min-h-10 px-3 text-xs')}
              >
                取消
              </button>
              <button
                onClick={handleGenerate}
                disabled={generating || !topic.trim()}
                className={cn(BTN_BASE, BTN_PRIMARY, 'min-h-10 px-3 text-xs')}
              >
                {generating ? '生成中…' : '开始生成'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
