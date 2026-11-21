import React, { useMemo } from 'react';
import { cn } from '../../lib/utils';
import { renderMarkdown } from '../../lib/markdown';
// KaTeX 公式的核心排版样式只在文章详情页 import；后台预览复用同一份，
// 否则 renderMarkdown 产出的公式结构在后台没有对应的版面样式（上下标/分数线错位）。
import 'katex/dist/katex.min.css';

/**
 * 后台 Markdown 预览
 *
 * - 渲染管线复用前台同一份 `lib/markdown.ts`（内部已做 XSS 净化），
 *   PostManager 只传正文，不在这里做任何数据写回：预览既不改 dirty，也不会触发保存；
 * - 排版直接复用 `.prose`：代码块 / 表格 / 引用 / 公式与文章详情页保持同一套样式，
 *   深浅主题跟随 `--sf-*` 令牌自动切换（`.prose` 本身不写死颜色）；
 * - 只读预览里的链接不跳转：后台弹窗内跳走会丢失未保存的正文，点击只拦截默认行为。
 *
 * 该组件不注册焦点、键盘或滚动锁，因此与 PostManager 既有的弹窗焦点陷阱 /
 * 背景滚动锁机制天然兼容（预览面板自身是否需要滚动由调用方容器决定）。
 */

export interface MarkdownPreviewProps {
  /** Markdown 源文（来自编辑中的 content，不做任何转义后再传入） */
  content: string;
  className?: string;
  /** 空正文时的提示文案 */
  emptyHint?: string;
}

export default function MarkdownPreview({
  content,
  className,
  emptyHint = '还没有正文，切回「编辑」开始写作。',
}: MarkdownPreviewProps) {
  const source = content ?? '';
  const html = useMemo(() => renderMarkdown(source), [source]);
  const hasContent = source.trim().length > 0;

  if (!hasContent) {
    return (
      <div
        data-testid="markdown-preview-empty"
        className={cn(
          'flex min-h-[200px] flex-col items-center justify-center gap-1.5 rounded-[3px] border border-dashed border-[var(--sf-line-control)] bg-[var(--sf-canvas)] px-3 py-8 text-center',
          className,
        )}
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--sf-ink-3)]">PREVIEW / 0</p>
        <p className="text-[13px] text-[var(--sf-ink-2)]">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div
      data-testid="markdown-preview"
      className={cn('prose min-w-0 max-w-full break-words [overflow-wrap:anywhere]', className)}
      onClick={(event) => {
        // 预览只读：链接不跳转（避免后台丢失未保存的编辑），图片也不响应拖拽
        const target = event.target as HTMLElement | null;
        if (target?.closest('a')) event.preventDefault();
      }}
      // 上游 renderMarkdown 已用 DOMPurify 净化，这里只负责展示
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
