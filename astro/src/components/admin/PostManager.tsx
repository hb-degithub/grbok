import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAdminPosts } from '../../hooks/domains/useAdminPosts';
import { cn } from '../../lib/utils';
import { sanitizeHtml } from '../../lib/security';
import { showToast } from '../ui/Toast';
import ConfirmDialog from '../ui/ConfirmDialog';
import MediaLibrary from './MediaLibrary';
import type { Post } from '../../lib/services/adminPostService';

type PostDraft = Omit<Post, 'id' | 'created' | 'updated' | 'author' | 'published_at' | 'views'> & { id?: string };
type PostFilter = 'all' | 'published' | 'draft' | 'archived';

const statusColors: Record<string, string> = {
  published: 'bg-success/15 text-success border-success/30',
  draft: 'bg-warning/15 text-warning border-warning/30',
  archived: 'bg-text-muted/15 text-text-muted border-text-muted/30',
};

const statusLabels: Record<string, string> = {
  published: '已发布',
  draft: '草稿',
  archived: '已归档',
};

const filterLabels: Record<PostFilter, string> = {
  all: '全部',
  published: '已发布',
  draft: '草稿',
  archived: '已归档',
};

const listVariants = {
  hidden: { opacity: 1 },
  visible: { transition: { staggerChildren: 0.04 } }
};
const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] } }
};

function formatDate(value?: string) {
  if (!value) return '未发布';
  return new Date(value).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

export default function PostManager() {
  const {
    posts,
    loading,
    filter,
    setFilter,
    query,
    setQuery,
    page,
    setPage,
    totalPages,
    editing,
    setEditing,
    saving,
    dirty,
    setDirty,
    allTags,
    selectedTagIds,
    setSelectedTagIds,
    updateStatus,
    deletePost,
    savePost,
  } = useAdminPosts();

  const [confirmState, setConfirmState] = useState<{ open: boolean; title: string; message: string; onConfirm: () => void }>({ open: false, title: '', message: '', onConfirm: () => {} });
  const [showMediaLibrary, setShowMediaLibrary] = useState(false);

  const handleDelete = (id: string) => {
    setConfirmState({
      open: true,
      title: '确认删除',
      message: '确定要删除这篇文章吗？此操作不可撤销。',
      onConfirm: () => deletePost(id),
    });
  };

  const handleEdit = (post: Post) => {
    setEditing(post);
    setDirty(false);
  };

  const handleNew = () => {
    setEditing({
      title: '',
      slug: '',
      excerpt: '',
      content: '',
      cover: '',
      status: 'draft',
    });
    setDirty(true);
  };

  const handleSave = () => {
    savePost();
  };

  const handleCoverSelect = (url: string) => {
    if (editing) {
      setEditing({ ...editing, cover: url });
      setDirty(true);
    }
    setShowMediaLibrary(false);
  };

  const filteredPosts = useMemo(() => {
    return posts;
  }, [posts]);

  return (
    <div className="space-y-4">
      {/* 工具栏 */}
      <div className="card rounded-md p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {(['all', 'published', 'draft', 'archived'] as PostFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  filter === f
                    ? 'bg-accent text-white'
                    : 'bg-bg-soft text-text-secondary hover:bg-accent/10'
                )}
              >
                {filterLabels[f]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="搜索文章..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="min-w-[200px] rounded-md border border-border bg-bg-soft px-3 py-2 text-sm text-text outline-none focus:border-accent"
            />
            <button onClick={handleNew} className="btn-primary min-h-10 px-4 text-xs">
              + 新建文章
            </button>
          </div>
        </div>
      </div>

      {/* 文章列表 */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-md bg-bg-soft" />
          ))}
        </div>
      ) : filteredPosts.length === 0 ? (
        <div className="card rounded-md p-8 text-center text-text-secondary">
          暂无文章
        </div>
      ) : (
        <motion.div
          variants={listVariants}
          initial="hidden"
          animate="visible"
          className="space-y-2"
        >
          {filteredPosts.map((post) => (
            <motion.div
              key={post.id}
              variants={itemVariants}
              className="card rounded-md p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn('rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase', statusColors[post.status])}>
                      {statusLabels[post.status]}
                    </span>
                    {post.is_pinned && (
                      <span className="rounded-md border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-[10px] uppercase text-accent">
                        置顶
                      </span>
                    )}
                    {post.is_featured && (
                      <span className="rounded-md border border-warning/30 bg-warning/10 px-2 py-0.5 font-mono text-[10px] uppercase text-warning">
                        精选
                      </span>
                    )}
                  </div>
                  <h3 className="mt-2 font-medium text-text">{post.title}</h3>
                  <p className="mt-1 line-clamp-2 text-sm text-text-secondary">{post.excerpt}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-text-secondary">
                    <span>{formatDate(post.published_at || post.updated)}</span>
                    <span>{post.views || 0} 浏览</span>
                    <span className="font-mono text-muted">/{post.slug}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => handleEdit(post)}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-md text-text-secondary hover:bg-accent/10 hover:text-accent"
                    title="编辑"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDelete(post.id)}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-md text-text-secondary hover:bg-danger/10 hover:text-danger"
                    title="删除"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage(page - 1)}
            disabled={page <= 1}
            className="btn-ghost min-h-10 px-4 text-xs disabled:opacity-50"
          >
            上一页
          </button>
          <span className="text-sm text-text-secondary">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage(page + 1)}
            disabled={page >= totalPages}
            className="btn-ghost min-h-10 px-4 text-xs disabled:opacity-50"
          >
            下一页
          </button>
        </div>
      )}

      {/* 编辑弹窗 */}
      <AnimatePresence>
        {editing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-stretch justify-center overflow-y-auto glass-overlay p-0 sm:items-center sm:p-4"
            onClick={() => setEditing(null)}
          >
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="card flex min-h-[var(--vvh,100dvh)] w-full max-w-4xl flex-col overflow-hidden rounded-none p-5 sm:min-h-0 sm:rounded-lg sm:p-6"
            >
              <h2 className="mb-6 break-words font-display text-lg font-bold uppercase tracking-wide text-text [overflow-wrap:anywhere]">
                {editing.id ? '编辑文章' : '新建文章'}
              </h2>
              
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-4">
                  <div>
                    <label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">标题</label>
                    <input
                      type="text"
                      value={editing.title}
                      onChange={(e) => { setEditing({ ...editing, title: e.target.value }); setDirty(true); }}
                      className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-bg-soft px-4 py-2.5 text-sm text-text outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">Slug</label>
                    <input
                      type="text"
                      value={editing.slug}
                      onChange={(e) => { setEditing({ ...editing, slug: e.target.value }); setDirty(true); }}
                      className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-bg-soft px-4 py-2.5 font-mono text-sm text-text outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">摘要</label>
                    <textarea
                      value={editing.excerpt || ''}
                      onChange={(e) => { setEditing({ ...editing, excerpt: e.target.value }); setDirty(true); }}
                      rows={3}
                      className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-bg-soft px-4 py-2.5 text-sm text-text outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">封面</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={editing.cover || ''}
                        onChange={(e) => { setEditing({ ...editing, cover: e.target.value }); setDirty(true); }}
                        className="min-h-10 flex-1 min-w-0 rounded-lg border border-border bg-bg-soft px-4 py-2.5 text-sm text-text outline-none focus:border-accent"
                        placeholder="封面图片 URL"
                      />
                      <button
                        onClick={() => setShowMediaLibrary(true)}
                        className="btn-ghost min-h-10 px-3 text-xs"
                      >
                        选择
                      </button>
                    </div>
                  </div>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">状态</label>
                    <select
                      value={editing.status}
                      onChange={(e) => { setEditing({ ...editing, status: e.target.value as Post['status'] }); setDirty(true); }}
                      className="min-h-10 w-full rounded-lg border border-border bg-bg-soft px-4 py-2.5 text-sm text-text outline-none focus:border-accent"
                    >
                      <option value="draft">草稿</option>
                      <option value="published">已发布</option>
                      <option value="archived">已归档</option>
                    </select>
                  </div>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={(editing as any).is_pinned || false}
                        onChange={(e) => { setEditing({ ...editing, is_pinned: e.target.checked } as any); setDirty(true); }}
                        className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
                      />
                      <span className="text-sm text-text">置顶</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={(editing as any).is_featured || false}
                        onChange={(e) => { setEditing({ ...editing, is_featured: e.target.checked } as any); setDirty(true); }}
                        className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
                      />
                      <span className="text-sm text-text">精选</span>
                    </label>
                  </div>
                  <div>
                    <label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">标签</label>
                    <div className="flex flex-wrap gap-2">
                      {allTags.map((tag) => (
                        <button
                          key={tag.id}
                          onClick={() => {
                            const newIds = selectedTagIds.includes(tag.id)
                              ? selectedTagIds.filter(id => id !== tag.id)
                              : [...selectedTagIds, tag.id];
                            setSelectedTagIds(newIds);
                            setDirty(true);
                          }}
                          className={cn(
                            'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                            selectedTagIds.includes(tag.id)
                              ? 'bg-accent text-white'
                              : 'bg-bg-soft text-text-secondary hover:bg-accent/10'
                          )}
                        >
                          {tag.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="mt-4">
                <label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">内容</label>
                <textarea
                  value={editing.content || ''}
                  onChange={(e) => { setEditing({ ...editing, content: e.target.value }); setDirty(true); }}
                  rows={12}
                  className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-bg-soft px-4 py-2.5 font-mono text-sm text-text outline-none focus:border-accent"
                />
              </div>
              
              <div className="mt-6 flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
                <button onClick={() => setEditing(null)} className="btn-ghost min-h-10 text-xs">
                  取消
                </button>
                <button onClick={handleSave} disabled={saving} className="btn-primary min-h-10 text-xs">
                  {saving ? '保存中...' : '保存文章'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 媒体库选择器 */}
      {showMediaLibrary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-lg bg-bg shadow-xl">
            <div className="flex items-center justify-between border-b border-border p-4">
              <h3 className="text-lg font-semibold text-text">选择封面图片</h3>
              <button
                onClick={() => setShowMediaLibrary(false)}
                className="rounded-md p-1 text-text-secondary hover:bg-bg-soft"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="max-h-[calc(90vh-60px)] overflow-auto p-4">
              <MediaLibrary onSelect={handleCoverSelect} onClose={() => setShowMediaLibrary(false)} />
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        message={confirmState.message}
        danger
        onConfirm={() => { confirmState.onConfirm(); setConfirmState(s => ({ ...s, open: false })); }}
        onCancel={() => setConfirmState(s => ({ ...s, open: false }))}
      />
    </div>
  );
}