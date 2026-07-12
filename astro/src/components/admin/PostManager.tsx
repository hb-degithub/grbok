import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getPocketBase } from '../../lib/pocketbase';
import { cn } from '../../lib/utils';
import { sanitizeHtml } from '../../lib/security';
import { showToast } from '../ui/Toast';
import ConfirmDialog from '../ui/ConfirmDialog';
import MediaLibrary from './MediaLibrary';
import type { Post } from '../../types/pocketbase';

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
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<PostFilter>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [editing, setEditing] = useState<Post | PostDraft | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const draftKey = useMemo(() => 'blog-draft-' + (editing?.id || '__new__'), [editing?.id]);
  const [draftRestored, setDraftRestored] = useState(false);
  const [allTags, setAllTags] = useState([]);
  const [selectedTagIds, setSelectedTagIds] = useState([]);
  const [confirmState, setConfirmState] = useState<{ open: boolean; title: string; message: string; onConfirm: () => void }>({ open: false, title: '', message: '', onConfirm: () => {} });

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    const pb = getPocketBase();
    try {
      const parts: string[] = [];
      if (filter !== 'all') parts.push(pb.filter('status = {:status}', { status: filter }));
      const keyword = query.trim();
      if (keyword) {
        // 标题/slug/摘要 模糊匹配（ PocketBase ~ 不区分大小写）
        const safeKeyword = keyword.replace(/["\\]/g, '');
        parts.push(pb.filter('(title ~ {:kw} || slug ~ {:kw} || excerpt ~ {:kw})', { kw: safeKeyword }));
      }
      const f = parts.length ? parts.join(' && ') : '';
      const result = await pb.collection('posts').getList<Post>(page, 20, { filter: f, sort: '-updated' });
      setPosts(result.items);
      setTotalPages(result.totalPages);
    } catch (err) {
      console.error('获取文章失败:', err);
    } finally {
      setLoading(false);
    }
  }, [filter, page, query]);

  useEffect(() => { fetchPosts(); }, [fetchPosts]);

  // 筛选/搜索变化时回到第 1 页
  useEffect(() => { setPage(1); }, [filter, query]);

  // Auto-save to localStorage when editing
  useEffect(() => {
    if (!editing) return;
    const timer = setTimeout(() => {
      try { localStorage.setItem(draftKey, JSON.stringify(editing)); } catch {}
    }, 2000);
    return () => clearTimeout(timer);
  }, [editing, draftKey]);

  // Beforeunload warning when there are unsaved changes
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // Load available tags
  useEffect(() => {
    if (!editing) return;
    const pb = getPocketBase();
    pb.collection("tags").getList(1, 100).then(r => {
      setAllTags(r.items.map((item) => ({ id: item.id, name: item.name, slug: item.slug })));
    }).catch(() => {});
    if (editing.id) {
      pb.collection("post_tags").getList(1, 100).then(r => {
        setSelectedTagIds(r.items.map((item) => item.tag_id));
      }).catch(() => {});
    } else setSelectedTagIds([]);
  }, [editing?.id]);

  // Draft recovery on mount
  useEffect(() => {
    if (draftRestored || editing) return;
    const savedNew = localStorage.getItem('blog-draft-__new__');
    if (savedNew) {
      try {
        const parsed = JSON.parse(savedNew);
        if (parsed.title) {
          setEditing(parsed);
          setDraftRestored(true);
          setDirty(true);
        }
      } catch {}
    }
  }, [draftRestored, editing]);

  // counts 基于 PocketBase 实际总数（通过 totalPages * perPage 估算），但精确计数需单独查询；
  // 此处仅显示当前页条数与总页数，避免每页重新计算误导。
  const pageLabel = `第 ${page}/${Math.max(totalPages, 1)} 页 · ${posts.length} 条`;

  const updateStatus = async (id: string, status: Post['status']) => {
    const pb = getPocketBase();
    const data: Record<string, unknown> = { status };
    if (status === 'published') data.published_at = new Date().toISOString();
    try {
      await pb.collection('posts').update(id, data);
      showToast('状态更新成功', 'success');
      fetchPosts();
    } catch (err) {
      console.error('更新文章状态失败:', err);
      showToast('状态更新失败', 'error');
    }
  };

  const deletePost = async (id: string) => {
    setConfirmState({ open: true, title: '确认删除', message: '确定删除这篇文章吗？此操作无法撤销。', onConfirm: async () => {
      const pb = getPocketBase();
      try {
        await pb.collection('posts').delete(id);
        showToast('文章已删除', 'success');
        fetchPosts();
      } catch (err) {
        console.error('删除文章失败:', err);
        showToast('删除文章失败', 'error');
      }
    }});
  };

  const savePost = async (skipChecks = false) => {
    if (!editing) return;
    if (!skipChecks && editing?.status === 'published') {
      const warnings = qualityChecks(editing);
      if (warnings.length > 0) {
        setConfirmState({ open: true, title: '发布前检查', message: '发布前检查发现问题，仍要发布吗？', onConfirm: () => savePost(true) });
        return;
      }
    }
    setSaving(true);
    const pb = getPocketBase();
    try {
      const data: Record<string, unknown> = {
        title: editing.title,
        slug: editing.slug,
        excerpt: editing.excerpt || '',
        content: editing.content || '',
        cover: editing.cover || '',
        status: editing.status,
        is_pinned: (editing as any).is_pinned ?? false,
        is_featured: (editing as any).is_featured ?? false,
        seo_title: (editing as any).seo_title || '',
        seo_description: (editing as any).seo_description || '',
        seo_keywords: (editing as any).seo_keywords || '',
      };
      const publishedAt = 'published_at' in editing ? editing.published_at : '';
      if (editing.status === 'published' && !publishedAt) data.published_at = new Date().toISOString();
      let savedPostId: string;
      if (editing.id && editing.id.trim()) {
        await pb.collection('posts').update(editing.id, data);
        savedPostId = editing.id;
      } else {
        const created = await pb.collection('posts').create({ ...data, author: pb.authStore.record?.id });
        savedPostId = created.id;
      }
      setEditing(null);
      clearSavedDraft();
      setDirty(false);
      fetchPosts();
      setSelectedTagIds([]);
      // Sync tags via post_tags
      try {
        if (savedPostId) {
          const existing = await pb.collection("post_tags").getList(1, 100, { filter: pb.filter('post_id = {:postId}', { postId: savedPostId }) }).catch(() => ({ items: [] }));
          const existingIds = existing.items.map(i => i.tag_id);
          const toRemove = existing.items.filter(i => !selectedTagIds.includes(i.tag_id));
          const toAdd = selectedTagIds.filter(id => !existingIds.includes(id)).filter(Boolean);
          await Promise.all(toRemove.map(i => pb.collection("post_tags").delete(i.id)));
          await Promise.all(toAdd.map(id => pb.collection("post_tags").create({ post_id: savedPostId, tag_id: id })));
        }
      } catch (e) { console.error("Tag sync failed:", e); }
      showToast('文章保存成功', 'success');
    } catch (err) {
      console.error('保存文章失败:', err);
      showToast('保存失败，请检查 slug 是否唯一。', 'error');
    } finally {
      setSaving(false);
    }
  };


  const qualityChecks = (post: typeof editing) => {
    if (!post) return [];
    const warnings: string[] = [];
    if (!post.title?.trim()) warnings.push('标题为空');
    if (!post.slug?.trim()) warnings.push('Slug 为空');
    if (post.title && post.title.length < 2) warnings.push('标题过短');
    if (!post.content?.trim()) warnings.push('正文为空');
    if (post.content && post.content.length < 50) warnings.push('正文过短（建议 50 字以上）');
    return warnings;
  };

  const clearSavedDraft = () => {
    try { localStorage.removeItem(draftKey); } catch {}
  };
  const startCreate = () => { setPreviewMode(false); setEditing({ id: '', title: '', slug: '', excerpt: '', content: '', cover: '', status: 'draft' }); };

  // 在 textarea 选区前后包裹标签
  const wrapSelection = (open: string, close: string, placeholder = '文本') => {
    const ta = contentRef.current;
    if (!ta || !editing) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = editing.content || '';
    const selected = before.slice(start, end) || placeholder;
    const next = before.slice(0, start) + open + selected + close + before.slice(end);
    setDirty(true);
    setEditing({ ...editing, content: next });
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + open.length;
      ta.setSelectionRange(pos, pos + selected.length);
    });
  };

  const insertLinePrefix = (prefix: string) => {
    const ta = contentRef.current;
    if (!ta || !editing) return;
    const start = ta.selectionStart;
    const before = editing.content || '';
    const lineStart = before.lastIndexOf('\n', start - 1) + 1;
    const next = before.slice(0, lineStart) + prefix + before.slice(lineStart);
    setDirty(true);
    setEditing({ ...editing, content: next });
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + prefix.length, start + prefix.length);
    });
  };

  return (
    <div className="space-y-4">
      <section className="card rounded-md p-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          {(['all', 'published', 'draft', 'archived'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'min-h-10 rounded-md border px-3 py-1.5 text-xs transition-all',
                filter === f
                  ? 'border-accent/30 bg-accent/10 text-accent'
                  : 'border-transparent text-text-secondary hover:border-border hover:bg-bg-soft hover:text-text'
              )}
            >
              {filterLabels[f]}
            </button>
          ))}
          <span className="hidden font-mono text-[10px] text-muted sm:inline">{pageLabel}</span>
          <div className="hidden min-w-[120px] flex-1 sm:block" />
          <label className="relative w-full sm:w-72">
            <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 21l-4.35-4.35M11 18a7 7 0 110-14 7 7 0 010 14z" /></svg>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索标题、slug、摘要" className="h-10 w-full rounded-md border border-border bg-bg-soft pl-9 pr-3 text-sm text-text outline-none transition focus:border-accent focus:bg-white" />
          </label>
          <button onClick={startCreate} className="btn-primary min-h-10 rounded-md px-3 text-xs">新建文章</button>
        </div>
      </section>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-md border border-border bg-white" />)}</div>
      ) : posts.length === 0 ? (
        <div className="card rounded-md p-12 text-center text-sm text-text-secondary">{query ? '没有匹配的文章。' : '没有找到文章。'}</div>
      ) : (
        <div className="space-y-3 lg:overflow-hidden lg:rounded-md lg:border lg:border-border lg:bg-white lg:shadow-xs">
          <div className="hidden grid-cols-[minmax(0,1fr)_110px_90px_110px] gap-3 border-b border-border bg-bg-soft px-4 py-2 font-mono text-[10px] uppercase tracking-wide text-muted lg:grid">
            <span>文章</span><span>状态</span><span>浏览</span><span className="text-right">操作</span>
          </div>
          <motion.div variants={listVariants} initial="hidden" animate="visible" className="space-y-3 lg:divide-y lg:divide-border lg:space-y-0">
            {posts.map((post) => (
              <motion.div key={post.id} layout variants={itemVariants} className="card rounded-md border border-border bg-white p-3 shadow-xs lg:grid lg:grid-cols-[minmax(0,1fr)_110px_90px_110px] lg:items-center lg:rounded-none lg:border-0 lg:bg-transparent lg:p-4 lg:shadow-none">
                <div className="flex min-w-0 items-start gap-3 lg:items-center">
                  {post.cover ? <img src={post.cover} alt="" className="h-11 w-16 shrink-0 rounded-md object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} /> : <div className="flex h-11 w-16 shrink-0 items-center justify-center rounded-md border border-border bg-bg-soft font-mono text-[10px] text-muted">NO IMG</div>}
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-text [overflow-wrap:anywhere] sm:truncate">{post.title}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted">
                      <span className="break-all">/{post.slug}</span>
                      <span>更新 {formatDate(post.updated)}</span>
                    </div>
                  </div>
                </div>
                <span className={'w-fit rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase ' + (statusColors[post.status] || '')}>{statusLabels[post.status] || post.status}</span>
                <span className="font-mono text-xs text-text-secondary">{post.views || 0}</span>
                <div className="flex flex-wrap items-center gap-1 border-t border-border/50 pt-2 lg:justify-end lg:border-0 lg:pt-0">
                  <button onClick={() => setEditing(post)} className="inline-flex h-10 w-10 items-center justify-center rounded-md text-text-secondary hover:bg-accent/10 hover:text-accent" title="编辑" aria-label="编辑文章">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                  </button>
                  {post.status !== 'published' && <button onClick={() => updateStatus(post.id, 'published')} className="inline-flex h-10 w-10 items-center justify-center rounded-md text-text-secondary hover:bg-success/10 hover:text-success" title="发布" aria-label="发布文章">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  </button>}
                  {post.status === 'published' && <button onClick={() => updateStatus(post.id, 'draft')} className="inline-flex h-10 w-10 items-center justify-center rounded-md text-text-secondary hover:bg-warning/10 hover:text-warning" title="撤回发布" aria-label="撤回发布">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  </button>}
                  <button onClick={() => deletePost(post.id)} className="inline-flex h-10 w-10 items-center justify-center rounded-md text-text-secondary hover:bg-danger/10 hover:text-danger" title="删除" aria-label="删除文章">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      )}

      {totalPages > 1 && (
        <nav className="flex flex-wrap items-center justify-center gap-2" aria-label="文章分页">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="focus-ring inline-flex h-10 min-w-10 items-center justify-center rounded-md border border-border bg-white px-3 text-sm text-text-secondary transition-colors hover:border-border-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            上一页
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
            .map((p, idx, arr) => (
              <span key={p} className="flex items-center gap-1">
                {idx > 0 && arr[idx - 1] !== p - 1 && <span className="px-1 text-muted">…</span>}
                <button
                  onClick={() => setPage(p)}
                  aria-current={page === p ? 'page' : undefined}
                  className={cn(
                    'focus-ring inline-flex h-10 min-w-10 items-center justify-center rounded-md border px-3 text-sm font-medium transition-all',
                    page === p
                      ? 'border-accent/30 bg-accent/10 text-accent'
                      : 'border-border bg-white text-text-secondary hover:border-border-hover hover:text-text'
                  )}
                >
                  {p}
                </button>
              </span>
            ))}
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="focus-ring inline-flex h-10 min-w-10 items-center justify-center rounded-md border border-border bg-white px-3 text-sm text-text-secondary transition-colors hover:border-border-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            下一页
          </button>
        </nav>
      )}

      <AnimatePresence>
        {editing && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-stretch justify-center overflow-y-auto glass-overlay p-0 sm:items-start sm:px-4 sm:pb-10 sm:pt-16" onClick={() => setEditing(null)}>
            <motion.div initial={{ opacity: 0, y: 18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 18, scale: 0.98 }} onClick={(e) => e.stopPropagation()} className="mobile-fullsheet card flex min-h-[var(--vvh,100dvh)] w-full max-w-4xl flex-col rounded-none p-4 shadow-xl sm:min-h-0 sm:rounded-md sm:p-5">
              <div className="mb-5 flex items-center justify-between gap-3 border-b border-border pb-3">
                <div className="min-w-0">
                  <h2 className="break-words text-base font-black text-text">{editing.id ? '编辑文章' : '新建文章'}</h2>
                  <p className="mt-0.5 text-xs text-text-secondary">保存后会同步到 PocketBase。</p>
                </div>
                <button onClick={() => setEditing(null)} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-bg-soft hover:text-text" title="关闭" aria-label="关闭编辑器">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto md:grid-cols-[minmax(0,1fr)_280px]">
                <div className="space-y-4">
                  <div><label className="mb-1.5 block font-mono text-xs uppercase tracking-wide text-text-secondary">标题</label>
                    <input type="text" value={editing.title} onChange={(e) => { setDirty(true); setEditing({ ...editing, title: e.target.value, slug: !editing.id ? e.target.value.toLowerCase().replace(/[^\w\u4e00-\u9fa5\s-]/g, '').replace(/[\s]+/g, '-').substring(0, 100) : editing.slug })}} className="min-h-11 w-full rounded-md border border-border bg-bg-soft px-3 py-2.5 text-sm text-text outline-none focus:border-accent focus:bg-white" /></div>
                  <div><label className="mb-1.5 block font-mono text-xs uppercase tracking-wide text-text-secondary">摘要</label>
                    <textarea value={editing.excerpt || ''} onChange={(e) => setEditing({ ...editing, excerpt: e.target.value })} rows={3} className="min-h-11 w-full rounded-md border border-border bg-bg-soft px-3 py-2.5 text-sm text-text outline-none focus:border-accent focus:bg-white" /></div>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <label className="block font-mono text-xs uppercase tracking-wide text-text-secondary">正文（HTML）</label>
                      <div className="flex items-center gap-1 rounded-md border border-border bg-bg-soft p-0.5">
                        <button type="button" onClick={() => setPreviewMode(false)} className={cn('rounded px-2 py-1 text-[11px] font-medium transition', !previewMode ? 'bg-white text-text shadow-sm' : 'text-text-secondary')}>编辑</button>
                        <button type="button" onClick={() => setPreviewMode(true)} className={cn('rounded px-2 py-1 text-[11px] font-medium transition', previewMode ? 'bg-white text-text shadow-sm' : 'text-text-secondary')}>预览</button>
                      </div>
                    </div>
                    {!previewMode ? (
                      <>
                        <div className="mb-2 flex flex-wrap gap-1 rounded-md border border-border bg-bg-soft p-1.5">
                          {[
                            { label: 'B', title: '粗体', action: () => wrapSelection('<strong>', '</strong>') },
                            { label: 'I', title: '斜体', action: () => wrapSelection('<em>', '</em>') },
                            { label: 'H2', title: '二级标题', action: () => insertLinePrefix('## ') },
                            { label: 'H3', title: '三级标题', action: () => insertLinePrefix('### ') },
                            { label: '“ ”', title: '引用', action: () => insertLinePrefix('> ') },
                            { label: '• 列表', title: '无序列表', action: () => insertLinePrefix('- ') },
                            { label: '链接', title: '插入链接', action: () => wrapSelection('<a href="https://">', '</a>', '链接文字') },
                            { label: '图片', title: '插入图片', action: () => wrapSelection('<img src="', '" alt="" />', 'https://') },
                            { label: '</>', title: '代码块', action: () => insertLinePrefix('    ') },
                            { label: '—', title: '分割线', action: () => insertLinePrefix('\n<hr />\n') },
                          ].map((b) => (
                            <button key={b.label} type="button" onClick={b.action} title={b.title} className="inline-flex h-8 min-w-8 items-center justify-center rounded px-2 text-xs font-medium text-text-secondary transition-colors hover:bg-white hover:text-text">
                              {b.label}
                            </button>
                          ))}
                        </div>
                        <textarea ref={contentRef} value={editing.content || ''} onChange={(e) => { setDirty(true); setEditing({ ...editing, content: e.target.value }); }} rows={14} className="min-h-11 w-full rounded-md border border-border bg-bg-soft px-3 py-2.5 font-mono text-sm text-text outline-none focus:border-accent focus:bg-white" />
                      </>
                    ) : (
                      <div className="prose max-w-none rounded-md border border-border bg-white px-4 py-3 text-sm text-text [overflow-wrap:anywhere]" dangerouslySetInnerHTML={{ __html: sanitizeHtml(editing.content || '') || '<p class="text-text-secondary">无内容</p>' }} />
                    )}
                  </div>
                </div>
                <aside className="space-y-4">
                  <div><label className="mb-1.5 block font-mono text-xs uppercase tracking-wide text-text-secondary">Slug</label>
                    <input type="text" value={editing.slug} onChange={(e) => { setDirty(true); setEditing({ ...editing, slug: e.target.value }); }} className="min-h-11 w-full rounded-md border border-border bg-bg-soft px-3 py-2.5 font-mono text-sm text-text outline-none focus:border-accent focus:bg-white" /></div>
                  <div><label className="mb-1.5 block font-mono text-xs uppercase tracking-wide text-text-secondary">状态</label>
                    <select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value as Post['status'] })} className="min-h-11 w-full rounded-md border border-border bg-bg-soft px-3 py-2.5 text-sm text-text outline-none focus:border-accent focus:bg-white">
                      <option value="draft">草稿</option><option value="published">已发布</option><option value="archived">已归档</option>
                    </select></div>
                  <div>
                    <label className="mb-1.5 block font-mono text-xs uppercase tracking-wide text-text-secondary">封面图片</label>
                    <div className="flex gap-2">
                      <input type="text" value={editing.cover || ''} onChange={(e) => setEditing({ ...editing, cover: e.target.value })} placeholder="https://..." className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-bg-soft px-3 py-2.5 font-mono text-sm text-text outline-none focus:border-accent focus:bg-white" />
                      <button type="button" onClick={() => setMediaPickerOpen(true)} className="btn-ghost min-h-11 shrink-0 rounded-md px-3 text-xs" title="从媒体库选择">媒体库</button>
                    </div>
                    {editing.cover && (() => { try { const u = new URL(editing.cover); if (u.protocol !== 'http:' && u.protocol !== 'https:') return null; } catch { return null; } return <img src={editing.cover} alt="封面预览" className="mt-3 aspect-video w-full rounded-md border border-border object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />; })()}
                  </div>
                  <div>
                    <label className="mb-1.5 block font-mono text-xs uppercase tracking-wide text-text-secondary">标签</label>
                    <div className="flex flex-wrap gap-1.5">
                      {allTags.length === 0 && <span className="text-xs text-text-secondary">无标签</span>}
                      {allTags.map(tag => (
                        <button key={tag.id} type="button" onClick={() => setSelectedTagIds(prev => prev.includes(tag.id) ? prev.filter(id => id !== tag.id) : [...prev, tag.id])} className={'rounded-md border px-2.5 py-1 text-xs font-medium transition-all ' + (selectedTagIds.includes(tag.id) ? 'border-accent/30 bg-accent/10 text-accent' : 'border-border bg-bg-soft text-text-secondary hover:border-border-hover hover:text-text')}>
                          {tag.name}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-md border border-border bg-bg-soft p-3 text-xs">
                    <div className="mb-2 font-mono text-[10px] uppercase text-text-secondary">SEO / </div>
                    <div className="flex flex-wrap gap-2 mb-2">
                      <label className="flex items-center gap-1.5 cursor-pointer text-text-secondary hover:text-text"><input type="checkbox" checked={(editing as any).is_pinned || false} onChange={(e) => setEditing({ ...editing, is_pinned: e.target.checked } as any)} className="h-3.5 w-3.5 rounded border-border accent-accent" /><span className="text-xs">置顶</span></label>
                      <label className="flex items-center gap-1.5 cursor-pointer text-text-secondary hover:text-text"><input type="checkbox" checked={(editing as any).is_featured || false} onChange={(e) => setEditing({ ...editing, is_featured: e.target.checked } as any)} className="h-3.5 w-3.5 rounded border-border accent-accent" /><span className="text-xs">精选</span></label>
                    </div>
                    <input type="text" value={(editing as any).seo_title || ""} onChange={(e) => setEditing({ ...editing, seo_title: e.target.value } as any)} placeholder="SEO 标题（可选）" className="mb-2 min-h-9 w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent" />
                    <input type="text" value={(editing as any).seo_description || ""} onChange={(e) => setEditing({ ...editing, seo_description: e.target.value } as any)} placeholder="SEO 描述" className="mb-2 min-h-9 w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent" />
                    <input type="text" value={(editing as any).seo_keywords || ""} onChange={(e) => setEditing({ ...editing, seo_keywords: e.target.value } as any)} placeholder="SEO 关键词，逗号分隔" className="min-h-9 w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent" />
                  </div>
                  <div className="rounded-md border border-border bg-bg-soft p-3 text-xs text-text-secondary">
                    <div className="flex justify-between gap-3"><span>标题字数</span><span className="font-mono">{editing.title.length}</span></div>
                    <div className="mt-2 flex justify-between gap-3"><span>正文字数</span><span className="font-mono">{(editing.content || '').length}</span></div>
                  </div>
                </aside>
              </div>
              <div className="sticky bottom-0 -mx-4 mt-5 flex flex-col-reverse gap-2 border-t border-border bg-white px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 backdrop-blur sm:static sm:mx-0 sm:flex-row sm:justify-end sm:bg-transparent sm:px-0 sm:pb-0">
                <button onClick={() => setEditing(null)} className="btn-ghost min-h-10 rounded-md text-xs">取消</button>
                <button onClick={savePost} disabled={saving} className="btn-primary min-h-10 rounded-md text-xs disabled:cursor-not-allowed disabled:opacity-60">{saving ? '保存中...' : '保存文章'}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {mediaPickerOpen && editing && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] flex items-stretch justify-center overflow-y-auto glass-overlay p-0 sm:items-center sm:p-4" onClick={() => setMediaPickerOpen(false)}>
            <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 18 }} onClick={(e) => e.stopPropagation()} className="card flex min-h-[var(--vvh,100dvh)] w-full max-w-3xl flex-col rounded-none p-4 sm:min-h-0 sm:max-h-[88vh] sm:rounded-md sm:p-5">
              <div className="mb-4 flex items-center justify-between gap-3 border-b border-border pb-3">
                <h2 className="text-base font-black text-text">从媒体库选择封面</h2>
                <button onClick={() => setMediaPickerOpen(false)} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-bg-soft hover:text-text" title="关闭" aria-label="关闭">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <MediaLibrary
                  onSelect={(url) => { setDirty(true); setEditing((cur) => cur ? { ...cur, cover: url } : cur); setMediaPickerOpen(false); showToast('已选择封面', 'success'); }}
                  onClose={() => setMediaPickerOpen(false)}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
