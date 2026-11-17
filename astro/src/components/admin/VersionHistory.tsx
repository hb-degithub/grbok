import React, { useState } from 'react';
import { useVersionHistory } from '../../hooks/domains/useVersionHistory';
import { showToast } from '../ui/Toast';
import type { PostVersion } from '../../lib/services/versionHistoryService';

/**
 * 版本历史对比组件 —— 超管后台新增模块。
 *
 * 路由：/admin/versions/
 * 权限：admin+
 * 依赖文件：post_versions collection（已有迁移 20260629005000）, lib/pocketbase.ts
 *
 * 资产保护：纯后台展示，不修改任何前端 DOM/动画。
 *
 * 视觉：科幻简约 —— 只用 --sf-* 令牌（surface/canvas + 细线 + 三档墨色 + 单一强调色），
 * 3px 方角、无阴影、无玻璃拟态；列表靠 1px 细线分隔，行 hover 只改底色；
 * 对比弹窗为实底表面 + 细线，双栏之间用 1px 竖线分隔。
 * 筛选、对比选择、清空与对比请求逻辑与改造前完全一致。
 */

const BTN_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-[3px] border font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)] disabled:cursor-not-allowed disabled:opacity-50';
const BTN_PRIMARY =
  'border-[var(--sf-accent)] bg-[var(--sf-accent)] text-[var(--sf-on-accent)] hover:border-[var(--sf-accent-ink)] hover:bg-[var(--sf-accent-ink)]';
const BTN_SECONDARY =
  'border-[var(--sf-line-control)] bg-[var(--sf-surface)] text-[var(--sf-ink)] hover:border-[var(--sf-accent)] hover:text-[var(--sf-accent-ink)]';
const BTN_SM = 'min-h-10 px-3 text-[12px]';

const SELECT_CLS =
  'min-h-[40px] min-w-0 rounded-[3px] border border-[var(--sf-line-control)] bg-[var(--sf-surface)] px-3 text-sm text-[var(--sf-ink)] outline-none transition-colors focus-visible:border-[var(--sf-accent)] focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)]';

const CHIP = 'inline-flex items-center rounded-[2px] border border-[var(--sf-line)] px-1.5 py-0.5 font-mono text-[10px] leading-none tracking-[0.08em] text-[var(--sf-ink-3)]';

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function truncate(text: string, length: number = 100) {
  if (text.length <= length) return text;
  return text.slice(0, length) + '...';
}

export default function VersionHistory() {
  const {
    versions,
    posts,
    selectedPost,
    setSelectedPost,
    loading,
    compareLeft,
    compareRight,
    toggleCompare,
    clearCompare,
    getCompareVersions,
  } = useVersionHistory();

  const [compareData, setCompareData] = useState<{ left: PostVersion; right: PostVersion } | null>(null);
  const [showCompare, setShowCompare] = useState(false);

  const handleCompare = async () => {
    if (!compareLeft || !compareRight) {
      showToast('请选择两个版本进行对比', 'warning');
      return;
    }
    const data = await getCompareVersions();
    if (data) {
      setCompareData(data);
      setShowCompare(true);
    }
  };

  const closeCompare = () => {
    setShowCompare(false);
    setCompareData(null);
  };

  return (
    <div className="min-w-0 space-y-3">
      {/* 筛选器 */}
      <div className="rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedPost}
            onChange={(e) => setSelectedPost(e.target.value)}
            aria-label="按文章筛选版本"
            className={`${SELECT_CLS} w-full sm:w-auto sm:min-w-[200px]`}
          >
            <option value="">全部文章</option>
            {posts.map((post) => (
              <option key={post.id} value={post.id}>
                {post.title}
              </option>
            ))}
          </select>
          <button
            onClick={handleCompare}
            disabled={!compareLeft || !compareRight}
            className={`${BTN_BASE} ${BTN_PRIMARY} ${BTN_SM}`}
          >
            对比选中版本
          </button>
          {(compareLeft || compareRight) && (
            <button
              onClick={clearCompare}
              className={`${BTN_BASE} ${BTN_SECONDARY} ${BTN_SM}`}
            >
              清除选择
            </button>
          )}
        </div>
        {(compareLeft || compareRight) && (
          <div className="mt-3 break-words border-t border-[var(--sf-line-soft)] pt-2 font-mono text-[11px] leading-relaxed text-[var(--sf-ink-3)] [overflow-wrap:anywhere]">
            已选择 (compareLeft ? 1 : 0) + (compareRight ? 1 : 0) 个版本
            {compareLeft && compareRight && '，点击"对比选中版本"查看差异'}
          </div>
        )}
      </div>

      {/* 版本列表 */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-[3px] border border-[var(--sf-line-soft)] bg-[var(--sf-canvas)]" />
          ))}
        </div>
      ) : versions.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] px-3 py-10 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--sf-ink-3)]">EMPTY / 0</p>
          <p className="text-[13px] text-[var(--sf-ink-2)]">暂无版本历史</p>
        </div>
      ) : (
        <div className="min-w-0 overflow-hidden rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)]">
          <div className="flex items-center justify-between gap-2 border-b border-[var(--sf-line)] bg-[var(--sf-canvas)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--sf-ink-3)]">
            <span>Version / 版本</span>
            <span className="tabular-nums">共 {versions.length} 条</span>
          </div>
          {versions.map((version) => {
            const selected = compareLeft === version.id || compareRight === version.id;
            return (
              <div
                key={version.id}
                className={`relative flex min-w-0 flex-wrap items-start justify-between gap-3 border-b border-[var(--sf-line-soft)] px-3 py-3 transition-colors last:border-b-0 hover:bg-[var(--sf-canvas)] ${
                  selected ? 'bg-[var(--sf-canvas)]' : ''
                }`}
              >
                {selected && <span className="absolute left-0 top-0 h-full w-[2px] bg-[var(--sf-accent)]" aria-hidden="true" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="break-words text-[13px] font-medium text-[var(--sf-ink)] [overflow-wrap:anywhere]">
                      {version.expand?.post_id?.title || version.title}
                    </span>
                    <span className={CHIP}>v{version.id.slice(0, 6)}</span>
                  </div>
                  <p className="mt-1 break-words text-[13px] leading-relaxed text-[var(--sf-ink-2)] [overflow-wrap:anywhere]">
                    {truncate(version.excerpt || version.content, 80)}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] tracking-[0.06em] text-[var(--sf-ink-3)]">
                    <span className="break-words [overflow-wrap:anywhere]">{version.expand?.editor?.name || '未知编辑'}</span>
                    <span className="tabular-nums">{formatDate(version.created)}</span>
                    {version.note && (
                      <span className="break-words text-[var(--sf-accent-ink)] [overflow-wrap:anywhere]">备注：{version.note}</span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => toggleCompare(version.id)}
                    aria-pressed={selected}
                    className={`${BTN_BASE} ${BTN_SM} ${
                      selected
                        ? 'border-[var(--sf-accent)] bg-[var(--sf-accent)] text-[var(--sf-on-accent)] hover:bg-[var(--sf-accent-ink)]'
                        : 'border-[var(--sf-line)] bg-[var(--sf-surface)] text-[var(--sf-ink-2)] hover:border-[var(--sf-line-strong)] hover:text-[var(--sf-ink)]'
                    }`}
                  >
                    {selected ? '已选择' : '选择对比'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 对比弹窗 */}
      {showCompare && compareData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--sf-scrim)] p-3 sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="版本对比"
            className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)]"
          >
            <div className="flex items-center justify-between gap-2 border-b border-[var(--sf-line)] px-3 py-2.5 sm:px-4">
              <h3 className="break-words text-sm font-bold tracking-tight text-[var(--sf-ink)]">版本对比</h3>
              <button
                onClick={closeCompare}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[3px] border border-[var(--sf-line)] text-[var(--sf-ink-2)] transition-colors hover:border-[var(--sf-line-control)] hover:text-[var(--sf-ink)]"
                title="关闭"
                aria-label="关闭"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="grid max-h-[calc(90vh-3.5rem)] min-h-0 grid-cols-1 overflow-auto sm:grid-cols-2">
              <div className="min-w-0 border-b border-[var(--sf-line)] p-3 sm:border-b-0 sm:border-r sm:p-4">
                <div className="mb-3 space-y-1 rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-canvas)] p-2 font-mono text-[10px] leading-relaxed tracking-[0.06em] text-[var(--sf-ink-3)]">
                  <p className="break-all">版本：{compareData.left.id.slice(0, 8)}</p>
                  <p className="tabular-nums">时间：{formatDate(compareData.left.created)}</p>
                  <p className="break-words [overflow-wrap:anywhere]">编辑：{compareData.left.expand?.editor?.name || '未知'}</p>
                </div>
                <h4 className="mb-2 break-words text-[13px] font-medium text-[var(--sf-ink)] [overflow-wrap:anywhere]">{compareData.left.title}</h4>
                <div className="prose prose-sm max-w-none text-[var(--sf-ink-2)]">
                  <pre className="whitespace-pre-wrap break-words rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-canvas)] p-3 font-mono text-xs text-[var(--sf-ink-2)] [overflow-wrap:anywhere]">
                    {compareData.left.content}
                  </pre>
                </div>
              </div>
              <div className="min-w-0 p-3 sm:p-4">
                <div className="mb-3 space-y-1 rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-canvas)] p-2 font-mono text-[10px] leading-relaxed tracking-[0.06em] text-[var(--sf-ink-3)]">
                  <p className="break-all">版本：{compareData.right.id.slice(0, 8)}</p>
                  <p className="tabular-nums">时间：{formatDate(compareData.right.created)}</p>
                  <p className="break-words [overflow-wrap:anywhere]">编辑：{compareData.right.expand?.editor?.name || '未知'}</p>
                </div>
                <h4 className="mb-2 break-words text-[13px] font-medium text-[var(--sf-ink)] [overflow-wrap:anywhere]">{compareData.right.title}</h4>
                <div className="prose prose-sm max-w-none text-[var(--sf-ink-2)]">
                  <pre className="whitespace-pre-wrap break-words rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-canvas)] p-3 font-mono text-xs text-[var(--sf-ink-2)] [overflow-wrap:anywhere]">
                    {compareData.right.content}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
