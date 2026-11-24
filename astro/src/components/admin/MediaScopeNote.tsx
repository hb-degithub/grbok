import React from 'react';

/**
 * 媒体库 / 相册管理的作用边界说明（后台）。
 *
 * 两个页面都在「内容」分组里，用户很容易混：媒体库是文章封面/正文插图的素材仓库，
 * 相册管理才是 /gallery 对外照片墙。这里用同一条细线提示 + 互相跳转链接把边界说清楚，
 * 视觉只用 --sf-* 令牌（与后台其他面板一致），不引入新颜色。
 */

export type MediaScopeKind = 'library' | 'gallery';

const SCOPES = {
  library: {
    label: '媒体库',
    text: '文章 / 封面用的素材仓库，不直接对外展示。',
    linkHref: '/admin/gallery',
    linkLabel: '去相册管理',
  },
  gallery: {
    label: '相册管理',
    text: '展示在 /gallery 的对外照片墙；需要新素材可去媒体库上传。',
    linkHref: '/admin/media',
    linkLabel: '去媒体库上传',
  },
} as const;

export default function MediaScopeNote({ kind }: { kind: MediaScopeKind }) {
  const scope = SCOPES[kind];
  return (
    <aside
      data-media-scope={kind}
      className="flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1 rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-canvas)] px-3 py-2"
    >
      <span className="mt-[0.45rem] h-1 w-1 shrink-0 bg-[var(--sf-accent)]" aria-hidden="true" />
      <p className="min-w-0 flex-1 break-words text-[12px] leading-5 text-[var(--sf-ink-2)] [overflow-wrap:anywhere]">
        <span className="font-semibold text-[var(--sf-ink)]">{scope.label}：</span>
        {scope.text}
      </p>
      <a
        href={scope.linkHref}
        className="shrink-0 font-mono text-[11px] tracking-[0.04em] text-[var(--sf-accent-ink)] underline-offset-2 transition-colors hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)]"
      >
        {scope.linkLabel} →
      </a>
    </aside>
  );
}
