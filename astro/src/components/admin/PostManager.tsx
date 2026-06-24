import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getPocketBase } from '../../lib/pocketbase';
import { cn } from '../../lib/utils';
import type { Post } from '../../types/pocketbase';

type PostDraft = Omit<Post, 'id' | 'created' | 'updated' | 'author' | 'published_at' | 'views'> & { id?: string };


const statusColors: Record<string, string> = {
  published: 'bg-success/15 text-success border-success/30',
  draft: 'bg-warning/15 text-warning border-warning/30',
  archived: 'bg-text-muted/15 text-text-muted border-text-muted/30',
};

export default function PostManager() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'published' | 'draft' | 'archived'>('all');
  const [editing, setEditing] = useState<Post | PostDraft | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    const pb = getPocketBase();
    try {
      const f = filter === 'all' ? '' : `status = "${filter.replace(/["\\]/g, "")}"`;
      const result = await pb.collection('posts').getList<Post>(1, 50, { filter: f, sort: '-created' });
      setPosts(result.items);
    } catch (err) { console.error('Failed to fetch posts:', err); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { fetchPosts(); }, [fetchPosts]);

  const updateStatus = async (id: string, status: Post['status']) => {
    const pb = getPocketBase();
    try { await pb.collection('posts').update(id, { status }); fetchPosts(); }
    catch (err) { console.error('Failed to update:', err); }
  };

  const deletePost = async (id: string) => {
    if (!confirm('Delete this post? This cannot be undone.')) return;
    const pb = getPocketBase();
    try { await pb.collection('posts').delete(id); fetchPosts(); }
    catch (err) { console.error('Failed to delete:', err); }
  };

  const savePost = async () => {
    if (!editing) return;
    setSaving(true);
    const pb = getPocketBase();
    try {
      const data = { title: editing.title, slug: editing.slug, excerpt: editing.excerpt || '', content: editing.content || '', cover: editing.cover || '', status: editing.status };
      if (editing.id && editing.id.trim()) { await pb.collection('posts').update(editing.id, data); }
      else { await pb.collection('posts').create({ ...data, author: pb.authStore.record?.id }); }
      setEditing(null); fetchPosts();
    } catch (err) { console.error('Failed to save:', err); alert('Save failed. Check slug uniqueness.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        {(['all', 'published', 'draft', 'archived'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={cn('rounded-lg px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-all',
            filter === f ? 'bg-accent/10 text-accent border border-accent/30' : 'text-text-secondary hover:text-text border border-transparent')}>{f}</button>
        ))}
        <div className="flex-1" />
        <button onClick={() => setEditing({ id: '', title: '', slug: '', excerpt: '', content: '', cover: '', status: 'draft' })} className="btn-primary text-xs">+ New Post</button>
      </div>
      {loading ? <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-bg-soft" />)}</div>
      : posts.length === 0 ? <div className="card rounded-xl p-12 text-center text-text-secondary">No posts found.</div>
      : <div className="space-y-2">
          {posts.map((post) => (
            <motion.div key={post.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card flex items-center gap-4 rounded-xl p-4">
              {post.cover && <img src={post.cover} alt="" className="h-12 w-20 shrink-0 rounded-md object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
              <div className="flex-1 min-w-0">
                <p className="truncate font-medium text-text">{post.title}</p>
                <p className="mt-0.5 font-mono text-[10px] text-muted">/{post.slug}</p>
              </div>
              <span className={'rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase ' + (statusColors[post.status] || '')}>{post.status}</span>
              <span className="text-xs text-text-secondary">{post.views || 0} views</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setEditing(post)} className="rounded-md p-1.5 text-text-secondary hover:bg-accent/10 hover:text-accent" title="Edit">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                </button>
                {post.status !== 'published' && <button onClick={() => updateStatus(post.id, 'published')} className="rounded-md p-1.5 text-text-secondary hover:bg-success/10 hover:text-success" title="Publish">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                </button>}
                {post.status === 'published' && <button onClick={() => updateStatus(post.id, 'draft')} className="rounded-md p-1.5 text-text-secondary hover:bg-warning/10 hover:text-warning" title="Unpublish">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </button>}
                <button onClick={() => deletePost(post.id)} className="rounded-md p-1.5 text-text-secondary hover:bg-danger/10 hover:text-danger" title="Delete">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      }
      <AnimatePresence>
        {editing && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto glass-overlay pt-20 pb-10" onClick={() => setEditing(null)}>
            <motion.div initial={{ opacity: 0, y: 20, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.98 }} onClick={(e) => e.stopPropagation()} className="card w-full max-w-2xl rounded-2xl p-6">
              <h2 className="mb-6 font-display text-lg font-bold uppercase tracking-wide text-text">{editing.id ? 'Edit Post' : 'New Post'}</h2>
              <div className="space-y-4">
                <div><label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">Title</label>
                  <input type="text" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value, slug: !editing.id ? e.target.value.toLowerCase().replace(/[^\w\u4e00-\u9fa5\s-]/g, '').replace(/[\s]+/g, '-').substring(0, 100) : editing.slug })} className="w-full rounded-lg border border-border bg-bg-soft px-4 py-2.5 text-sm text-text outline-none focus:border-accent" /></div>
                <div><label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">Slug</label>
                  <input type="text" value={editing.slug} onChange={(e) => setEditing({ ...editing, slug: e.target.value })} className="w-full rounded-lg border border-border bg-bg-soft px-4 py-2.5 font-mono text-sm text-text outline-none focus:border-accent" /></div>
                <div><label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">Excerpt</label>
                  <textarea value={editing.excerpt || ''} onChange={(e) => setEditing({ ...editing, excerpt: e.target.value })} rows={2} className="w-full rounded-lg border border-border bg-bg-soft px-4 py-2.5 text-sm text-text outline-none focus:border-accent" /></div>
                <div><label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">Content (HTML)</label>
                  <textarea value={editing.content || ''} onChange={(e) => setEditing({ ...editing, content: e.target.value })} rows={10} className="w-full rounded-lg border border-border bg-bg-soft px-4 py-2.5 font-mono text-sm text-text outline-none focus:border-accent" /></div>
                <div><label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">Cover Image URL</label>
                  <input type="text" value={editing.cover || ''} onChange={(e) => setEditing({ ...editing, cover: e.target.value })} placeholder="https://..." className="w-full rounded-lg border border-border bg-bg-soft px-4 py-2.5 font-mono text-sm text-text outline-none focus:border-accent" />
                  {editing.cover && <img src={editing.cover} alt="Cover preview" className="mt-3 aspect-video w-full rounded-lg border border-border object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}</div>
                <div><label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">Status</label>
                  <select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value as Post['status'] })} className="w-full rounded-lg border border-border bg-bg-soft px-4 py-2.5 text-sm text-text outline-none focus:border-accent">
                    <option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option>
                  </select></div>
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <button onClick={() => setEditing(null)} className="btn-ghost text-xs">Cancel</button>
                <button onClick={savePost} disabled={saving} className="btn-primary text-xs">{saving ? 'Saving...' : 'Save Post'}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
