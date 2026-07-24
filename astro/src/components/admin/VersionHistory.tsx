import React, { useState, useEffect, useCallback } from 'react';
import { getPocketBase } from '../../lib/pocketbase';
import { showToast } from '../ui/Toast';

/**
 * 版本历史对比组件 —— 超管后台新增模块。
 *
 * 路由：/admin/versions/
 * 权限：admin+
 * 依赖文件：post_versions collection（已有迁移 20260629005000）, lib/pocketbase.ts
 *
 * 资产保护：纯后台展示，不修改任何前端 DOM/动画。
 */

interface PostVersion {
  id: string;
  post_id: string;
  content: string;
  title: string;
  excerpt: string;
  editor: string;
  note?: string;
  created: string;
    expand?: {
    post_id?: { id: string; title: string; slug: string };
    editor?: { id: string; name: string };
  };
}

export default function VersionHistory() {
  const [versions, setVersions] = useState<PostVersion[]>([]);
  const [posts, setPosts] = useState<{ id: string; title: string; slug: string }[]>([]);
  const [selectedPost, setSelectedPost] = useState('');
  const [loading, setLoading] = useState(true);
  const [compareLeft, setCompareLeft] = useState<string | null>(null);
  const [compareRight, setCompareRight] = useState<string | null>(null);
  const pb = getPocketBase();

  const loadPosts = useCallback(async () => {
    try {
      const res = await pb.collection('posts').getList(1, 200, {
        sort: '-updated',
        fields: 'id,title,slug',
      });
      setPosts(res.items);
    } catch (err) {
      console.error('Failed to load posts:', err);
    }
  }, [pb]);

  const loadVersions = useCallback(async () => {
    if (!selectedPost) {
      setVersions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await pb.collection('post_versions').getList(1, 50, {
        filter: `post_id = "${selectedPost}"`,
        sort: '-created',
        expand: 'post_id,editor',
      });
      setVersions(res.items);
    } catch {
      setVersions([]);
    } finally {
      setLoading(false);
    }
  }, [pb, selectedPost]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  useEffect(() => {
    loadVersions();
  }, [loadVersions]);

  const restoreVersion = async (version: PostVersion) => {
    if (!confirm(`确定恢复到版本 "${version.note || version.title}" 吗？当前内容将被覆盖。`)) return;
    try {
      await pb.collection('posts').update(version.post_id, {
        content: version.content,
        title: version.title,
        excerpt: version.excerpt,
      });
      showToast('版本已恢复', 'success');
    } catch {
      showToast('恢复失败', 'error');
    }
  };

  const getDiffPreview = (left: PostVersion | undefined, right: PostVersion | undefined) => {
    if (!left || !right) return null;
    const leftLines = left.content.split('\n');
    const rightLines = right.content.split('\n');
    const maxLines = Math.min(Math.max(leftLines.length, rightLines.length), 30);
    const rows: { left: string; right: string; diff: boolean }[] = [];
    for (let i = 0; i < maxLines; i++) {
      const l = leftLines[i] || '';
      const r = rightLines[i] || '';
      rows.push({ left: l, right: r, diff: l !== r });
    }
    return rows;
  };

  const leftVersion = versions.find((v) => v.id === compareLeft);
  const rightVersion = versions.find((v) => v.id === compareRight);
  const diffRows = getDiffPreview(leftVersion, rightVersion);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-zinc-950 dark:text-zinc-50">版本历史</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">查看文章历史版本，对比差异，恢复旧版本。</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={selectedPost}
          onChange={(e) => {
            setSelectedPost(e.target.value);
            setCompareLeft(null);
            setCompareRight(null);
          }}
          className="min-h-9 rounded-md border border-border bg-white px-3 py-1.5 text-sm text-text outline-none dark:bg-zinc-800"
          aria-label="选择文章"
        >
          <option value="">选择文章...</option>
          {posts.map((p) => (
            <option key={p.id} value={p.id}>{p.title}</option>
          ))}
        </select>
        {selectedPost && (
          <span className="text-xs text-zinc-500">{versions.length} 个版本</span>
        )}
      </div>

      {loading ? (
        <div className="animate-pulse space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-lg bg-zinc-100 dark:bg-zinc-800" />
          ))}
        </div>
      ) : !selectedPost ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center text-sm text-zinc-400">
          请选择一篇文章查看版本历史
        </div>
      ) : versions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center text-sm text-zinc-400">
          该文章暂无历史版本
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">对比</th>
                  <th className="px-4 py-3 text-left font-medium">版本备注</th>
                  <th className="px-4 py-3 text-left font-medium">保存者</th>
                  <th className="px-4 py-3 text-left font-medium">时间</th>
                  <th className="px-4 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {versions.map((v) => (
                  <tr key={v.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button
                          onClick={() => setCompareLeft(v.id === compareLeft ? null : v.id)}
                          className={`h-6 w-6 rounded text-xs font-bold ${
                            compareLeft === v.id ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800'
                          }`}
                          title="设为左侧对比"
                        >L</button>
                        <button
                          onClick={() => setCompareRight(v.id === compareRight ? null : v.id)}
                          className={`h-6 w-6 rounded text-xs font-bold ${
                            compareRight === v.id ? 'bg-emerald-600 text-white' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800'
                          }`}
                          title="设为右侧对比"
                        >R</button>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-text">{v.note || v.title}</td>
                    <td className="px-4 py-3 text-zinc-500">{v.expand?.editor?.name || '—'}</td>
                    <td className="px-4 py-3 text-zinc-500">{new Date(v.created).toLocaleString('zh-CN')}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => restoreVersion(v)}
                        className="rounded-md px-3 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/30"
                      >恢复</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {diffRows && (
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="border-b border-border bg-zinc-50 px-4 py-2 text-xs font-medium text-zinc-500 dark:bg-zinc-900">
                版本对比：{leftVersion?.note || leftVersion?.title} → {rightVersion?.note || rightVersion?.title}
              </div>
              <div className="max-h-[400px] overflow-auto">
                <table className="w-full font-mono text-xs">
                  <tbody className="divide-y divide-border">
                    {diffRows.map((row, i) => (
                      <tr key={i} className={row.diff ? 'bg-amber-50 dark:bg-amber-950/20' : ''}>
                        <td className="w-10 px-2 py-1 text-right text-zinc-400">{i + 1}</td>
                        <td className="px-2 py-1 text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap break-all">{row.left || '—'}</td>
                        <td className="px-2 py-1 text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap break-all">{row.right || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
