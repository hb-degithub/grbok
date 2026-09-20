import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAiAssist } from '../../hooks/domains/useAiAssist';
import type { AiArticleLength } from '../../lib/services/aiAssistService';
import { showToast } from '../ui/Toast';
import { cn } from '../../lib/utils';

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
  'min-h-10 w-full min-w-0 rounded-lg border border-border bg-bg-soft px-4 py-2.5 text-sm text-text outline-none focus:border-accent disabled:opacity-60';
const labelClass = 'mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary';

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
          className="fixed inset-0 z-50 flex items-stretch justify-center overflow-y-auto glass-overlay p-0 sm:items-center sm:p-4"
          onClick={() => { if (!generating) onClose(); }}
        >
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            className="card flex min-h-[var(--vvh,100dvh)] w-full max-w-lg flex-col overflow-hidden rounded-none p-5 sm:min-h-0 sm:rounded-lg sm:p-6"
          >
            <h2 className="mb-6 font-display text-lg font-bold uppercase tracking-wide text-text">
              AI 生成文章
            </h2>

            <div className="space-y-4">
              <div>
                <label className={labelClass}>主题 *</label>
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  disabled={generating}
                  placeholder="例如：Astro 岛屿架构的按需水合原理"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>大纲</label>
                <textarea
                  value={outline}
                  onChange={(e) => setOutline(e.target.value)}
                  disabled={generating}
                  rows={4}
                  placeholder="可选。分点列出希望覆盖的内容，留空由 AI 自行组织"
                  className={cn(inputClass, 'font-mono')}
                />
              </div>
              <div>
                <label className={labelClass}>风格</label>
                <input
                  type="text"
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  disabled={generating}
                  placeholder="技术教程/随笔/评测"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>篇幅</label>
                <div className="flex flex-wrap gap-2">
                  {LENGTH_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      disabled={generating}
                      onClick={() => setLength(option.value)}
                      className={cn(
                        'rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60',
                        length === option.value
                          ? 'bg-accent text-white'
                          : 'bg-bg-soft text-text-secondary hover:bg-accent/10'
                      )}
                    >
                      {option.label} · {option.hint}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {generating && (
              <div className="mt-5 rounded-lg border border-accent/25 bg-accent/10 px-4 py-3 text-xs text-accent">
                AI 生成中，通常需要 30-90 秒，请勿关闭…
              </div>
            )}

            <div className="mt-6 flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
              <button
                onClick={onClose}
                disabled={generating}
                className="btn-ghost min-h-10 text-xs disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleGenerate}
                disabled={generating || !topic.trim()}
                className="btn-primary min-h-10 text-xs disabled:opacity-50"
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
