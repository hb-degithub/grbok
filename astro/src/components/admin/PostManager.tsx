import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getPocketBase } from '../../lib/pocketbase';
import { cn } from '../../lib/utils';
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

function formatDate(value?: string) {
  if (!value) return '未发布';
  return new Date(value).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

export default function PostManager() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<PostFilter>('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Post | PostDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const draftKey = useMemo(() => 'blog-draft-' + (editing?.id || '__new__'), [editing?.id]);
  const [draftRestored, setDraftRestored] = useState(false);
  const [allTags, setAllTags] = useState([]);
  const [selectedTagIds, setSelectedTagIds] = useState([]);

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    const pb = getPocketBase();
    try {
      const f = filter === 'all' ? '' : `status = "${filter}"`;
      const result = await pb.collection('posts').getList<Post>(1, 80, { filter: f, sort: '-updated' });
      setPosts(result.items);
    } catch (err) {
      console.error('获取文章失败:', err);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { fetchPosts(); }, [fetchPosts]);

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

  const counts = useMemo(() => ({
    all: posts.length,
    published: posts.filter((post) => post.status === 'published').length,
    draft: posts.filter((post) => post.status === 'draft').length,
    archived: posts.filter((post) => post.status === 'archived').length,
  }), [posts]);

  const filteredPosts = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return posts;
    return posts.filter((post) => [post.title, post.slug, post.excerpt].some((value) => String(value || '').toLowerCase().includes(keyword)));
  }, [posts, query]);

  const updateStatus = async (id: string, status: Post['status']) => {
    const pb = getPocketBase();
    const data: Record<string, unknown> = { status };
    if (status === 'published') data.published_at = new Date().toISOString();
    try {
      await pb.collection('posts').update(id, data);
      fetchPosts();
    } catch (err) {
      console.error('更新文章状态失败:', err);
    }
  };

  const deletePost = async (id: string) => {
    if (!confirm('确定删除这篇文章吗？此操作无法撤销。')) return;
    const pb = getPocketBase();
    try {
      await pb.collection('posts').delete(id);
      fetchPosts();
    } catch (err) {
      console.error('删除文章失败:', err);
    }
  };

  const savePost = async (skipChecks = false) => {
    if (!editing) return;
    if (!skipChecks && editing?.status === 'published') {
      const warnings = qualityChecks(editing);
      if (warnings.length > 0) {
        if (!confirm('发布前检查发现问题，仍要发布吗？')) return;
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
      };
      const publishedAt = 'published_at' in editing ? editing.published_at : '';
      if (editing.status === 'published' && !publishedAt) data.published_at = new Date().toISOString();
      if (editing.id && editing.id.trim()) await pb.collection('posts').update(editing.id, data);
      else await pb.collection('posts').create({ ...data, author: pb.authStore.record?.id });
      setEditing(null);
      clearSavedDraft();
      setDirty(false);
      fetchPosts();
      setSelectedTagIds([]);
      // Sync tags via post_tags
      try {
        const savedPostId = editing.id?.trim() || pb.authStore.record?.id;
        if (savedPostId) {
          const existing = await pb.collection("post_tags").getList(1, 100, { filter: "post_id=\"" + editing.id + "\"" }).catch(() => ({ items: [] }));
          const existingIds = existing.items.map(i => i.tag_id);
          const toRemove = existing.items.filter(i => !selectedTagIds.includes(i.tag_id));
          const toAdd = selectedTagIds.filter(id => !existingIds.includes(id)).filter(Boolean);
          await Promise.all(toRemove.map(i => pb.collection("post_tags").delete(i.id)));
          await Promise.all(toAdd.map(id => pb.collection("post_tags").create({ post_id: editing.id, tag_id: id })));
        }
      } catch (e) { console.error("Tag sync failed:", e); }
    } catch (err) {
      console.error('保存文章失败:', err);
      alert('保存失败，请检查 slug 是否唯一。');
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
  const startCreate = () => setEditing({ id: '', title: '', slug: '', excerpt: '', content: '', cover: '', status: 'draft' });

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
              {filterLabels[f]} <span className="ml-1 font-mono text-[10px] text-muted">{counts[f]}</span>
            </button>
          ))}
          <div className="hidden min-w-[220px] flex-1 sm:block" />
          <label className="relative w-full sm:w-72">
            <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 21l-4.35-4.35M11 18a7 7 0 110-14 7 7 0 010 14z" /></svg>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索标题、slug、摘要" className="h-10 w-full rounded-md border border-border bg-bg-soft pl-9 pr-3 text-sm text-text outline-none transition focus:border-accent focus:bg-white" />
          </label>
          <button onClick={startCreate} className="btn-primary min-h-10 rounded-md px-3 text-xs">新建文章</button>
        </div>
      </section>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-md border border-border bg-white" />)}</div>
      ) : filteredPosts.length === 0 ? (
        <div className="card rounded-md p-12 text-center text-sm text-text-secondary">没有找到文章。</div>
      ) : (
        <div className="space-y-3 lg:overflow-hidden lg:rounded-md lg:border lg:border-border lg:bg-white lg:shadow-xs">
          <div className="hidden grid-cols-[minmax(0,1fr)_110px_90px_110px] gap-3 border-b border-border bg-bg-soft px-4 py-2 font-mono text-[10px] uppercase tracking-wide text-muted lg:grid">
            <span>文章</span><span>状态</span><span>浏览</span><span className="text-right">操作</span>
          </div>
          <div className="space-y-3 lg:divide-y lg:divide-border lg:space-y-0">
            {filteredPosts.map((post) => (
              <motion.div key={post.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card rounded-md border border-border bg-white p-3 shadow-xs lg:grid lg:grid-cols-[minmax(0,1fr)_110px_90px_110px] lg:items-center lg:rounded-none lg:border-0 lg:bg-transparent lg:p-4 lg:shadow-none">
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
          </div>
        </div>
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
                  <div><label className="mb-1.5 block font-mono text-xs uppercase tracking-wide text-text-secondary">正文（HTML）</label>
                    <textarea value={editing.content || ''} onChange={(e) => setEditing({ ...editing, content: e.target.value })} rows={14} className="min-h-11 w-full rounded-md border border-border bg-bg-soft px-3 py-2.5 font-mono text-sm text-text outline-none focus:border-accent focus:bg-white" /></div>
                </div>
                <aside className="space-y-4">
                  <div><label className="mb-1.5 block font-mono text-xs uppercase tracking-wide text-text-secondary">Slug</label>
                    <input type="text" value={editing.slug} onChange={(e) => { setDirty(true); setEditing({ ...editing, slug: e.target.value }); }} className="min-h-11 w-full rounded-md border border-border bg-bg-soft px-3 py-2.5 font-mono text-sm text-text outline-none focus:border-accent focus:bg-white" /></div>
                  <div><label className="mb-1.5 block font-mono text-xs uppercase tracking-wide text-text-secondary">状态</label>
                    <select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value as Post['status'] })} className="min-h-11 w-full rounded-md border border-border bg-bg-soft px-3 py-2.5 text-sm text-text outline-none focus:border-accent focus:bg-white">
                      <option value="draft">草稿</option><option value="published">已发布</option><option value="archived">已归档</option>
                    </select></div>
                  <div><label className="mb-1.5 block font-mono text-xs uppercase tracking-wide text-text-secondary">封面图片 URL</label>
                    <input type="text" value={editing.cover || ''} onChange={(e) => setEditing({ ...editing, cover: e.target.value })} placeholder="https://..." className="min-h-11 w-full rounded-md border border-border bg-bg-soft px-3 py-2.5 font-mono text-sm text-text outline-none focus:border-accent focus:bg-white" />
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
                      <label className="flex items-center gap-1.5 cursor-pointer text-text-secondary hover:text-text"><input type="checkbox" checked={(editing as any).is_pinned || false} onChange={(e) => setEditing({ ...editing, is_pinned: e.target.checked } as any)} className="h-3.5 w-3.5 rounded border-border accent-accent" /><span className="text-xs"></span></label>
                      <label className="flex items-center gap-1.5 cursor-pointer text-text-secondary hover:text-text"><input type="checkbox" checked={(editing as any).is_featured || false} onChange={(e) => setEditing({ ...editing, is_featured: e.target.checked } as any)} className="h-3.5 w-3.5 rounded border-border accent-accent" /><span className="text-xs"></span></label>
                    </div>
                    <input type="text" value={(editing as any).seo_title || ""} onChange={(e) => setEditing({ ...editing, seo_title: e.target.value } as any)} placeholder="SEO ..." className="mb-2 min-h-9 w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent" />
                    <input type="text" value={(editing as any).seo_description || ""} onChange={(e) => setEditing({ ...editing, seo_description: e.target.value } as any)} placeholder="SEO ..." className="mb-2 min-h-9 w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent" />
                    <input type="text" value={(editing as any).seo_keywords || ""} onChange={(e) => setEditing({ ...editing, seo_keywords: e.target.value } as any)} placeholder="SEO ..." className="min-h-9 w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent" />
                  </div>
                  <div className="rounded-md border border-border bg-bg-soft p-3 text-xs text-text-secondary">
                    <div className="flex justify-between gap-3"><span>标题字数</span><span className="font-mono">{editing.title.length}</span></div>
                    <div className="mt-2 flex justify-between gap-3"><span>正文字数</span><span className="font-mono">{(editing.content || '').length}</span></div>
                  </div>
                </aside>
              </div>
              <div className="sticky bottom-0 -mx-4 mt-5 flex flex-col-reverse gap-2 border-t border-border bg-white/95 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 backdrop-blur sm:static sm:mx-0 sm:flex-row sm:justify-end sm:bg-transparent sm:px-0 sm:pb-0">
                <button onClick={() => setEditing(null)} className="btn-ghost min-h-10 rounded-md text-xs">取消</button>
                <button onClick={savePost} disabled={saving} className="btn-primary min-h-10 rounded-md text-xs disabled:cursor-not-allowed disabled:opacity-60">{saving ? '保存中...' : '保存文章'}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
