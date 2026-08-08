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
 */

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
    <div className="space-y-4">
      {/* 筛选器 */}
      <div className="card rounded-md p-4">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={selectedPost}
            onChange={(e) => setSelectedPost(e.target.value)}
            className="min-w-[200px] rounded-md border border-border bg-bg-soft px-3 py-2 text-sm text-text outline-none focus:border-accent"
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
            className="btn-primary min-h-10 px-4 text-xs disabled:opacity-50"
          >
            对比选中版本
          </button>
          {(compareLeft || compareRight) && (
            <button
              onClick={clearCompare}
              className="btn-ghost min-h-10 px-4 text-xs"
            >
              清除选择
            </button>
          )}
        </div>
        {(compareLeft || compareRight) && (
          <div className="mt-3 text-xs text-text-secondary">
            已选择 (compareLeft ? 1 : 0) + (compareRight ? 1 : 0) 个版本
            {compareLeft && compareRight && '，点击"对比选中版本"查看差异'}
          </div>
        )}
      </div>

      {/* 版本列表 */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-md bg-bg-soft" />
          ))}
        </div>
      ) : versions.length === 0 ? (
        <div className="card rounded-md p-8 text-center text-text-secondary">
          暂无版本历史
        </div>
      ) : (
        <div className="space-y-2">
          {versions.map((version) => (
            <div
              key={version.id}
              className={`card rounded-md p-4 transition-colors ${
                compareLeft === version.id || compareRight === version.id
                  ? 'border-accent bg-accent/5'
                  : ''
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-text">
                      {version.expand?.post_id?.title || version.title}
                    </span>
                    <span className="rounded-md border border-border bg-bg-soft px-2 py-0.5 font-mono text-[10px] uppercase text-text-secondary">
                      v{version.id.slice(0, 6)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-text-secondary">
                    {truncate(version.excerpt || version.content, 80)}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-text-secondary">
                    <span>{version.expand?.editor?.name || '未知编辑'}</span>
                    <span>{formatDate(version.created)}</span>
                    {version.note && (
                      <span className="text-accent">备注：{version.note}</span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => toggleCompare(version.id)}
                    className={`min-h-10 rounded-md px-3 text-xs font-medium transition-colors ${
                      compareLeft === version.id || compareRight === version.id
                        ? 'bg-accent text-white'
                        : 'bg-bg-soft text-text-secondary hover:bg-accent/10'
                    }`}
                  >
                    {compareLeft === version.id || compareRight === version.id
                      ? '已选择'
                      : '选择对比'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 对比弹窗 */}
      {showCompare && compareData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-lg bg-bg shadow-xl">
            <div className="flex items-center justify-between border-b border-border p-4">
              <h3 className="text-lg font-semibold text-text">版本对比</h3>
              <button
                onClick={closeCompare}
                className="rounded-md p-1 text-text-secondary hover:bg-bg-soft"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="grid max-h-[calc(90vh-60px)] grid-cols-2 divide-x divide-border overflow-auto">
              <div className="p-4">
                <div className="mb-3 rounded-md bg-bg-soft p-2 text-xs text-text-secondary">
                  <p>版本：{compareData.left.id.slice(0, 8)}</p>
                  <p>时间：{formatDate(compareData.left.created)}</p>
                  <p>编辑：{compareData.left.expand?.editor?.name || '未知'}</p>
                </div>
                <h4 className="mb-2 font-medium text-text">{compareData.left.title}</h4>
                <div className="prose prose-sm max-w-none text-text-secondary">
                  <pre className="whitespace-pre-wrap rounded-md bg-bg-soft p-3 font-mono text-xs">
                    {compareData.left.content}
                  </pre>
                </div>
              </div>
              <div className="p-4">
                <div className="mb-3 rounded-md bg-bg-soft p-2 text-xs text-text-secondary">
                  <p>版本：{compareData.right.id.slice(0, 8)}</p>
                  <p>时间：{formatDate(compareData.right.created)}</p>
                  <p>编辑：{compareData.right.expand?.editor?.name || '未知'}</p>
                </div>
                <h4 className="mb-2 font-medium text-text">{compareData.right.title}</h4>
                <div className="prose prose-sm max-w-none text-text-secondary">
                  <pre className="whitespace-pre-wrap rounded-md bg-bg-soft p-3 font-mono text-xs">
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