import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getPocketBase } from '../../lib/pocketbase';
import type { Tag } from '../../types/pocketbase';

export default function TagManager() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Tag | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchTags = useCallback(async () => {
    setLoading(true);
    const pb = getPocketBase();
    try { const result = await pb.collection('tags').getList<Tag>(1, 100, { sort: 'name' }); setTags(result.items); }
    catch (err) { console.error('Failed to fetch tags:', err); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchTags(); }, [fetchTags]);

  const saveTag = async () => {
    if (!editing || !editing.name) return;
    setSaving(true);
    const pb = getPocketBase();
    try {
      const data = { name: editing.name, slug: editing.slug || editing.name.toLowerCase().replace(/[^\w\u4e00-\u9fa5]/g, '-').replace(/-+/g, '-'), description: editing.description || '' };
      if (editing.id) { await pb.collection('tags').update(editing.id, data); }
      else { await pb.collection('tags').create(data); }
      setEditing(null); fetchTags();
    } catch (err) { console.error('Failed to save:', err); alert('Failed. Check slug uniqueness.'); }
    finally { setSaving(false); }
  };

  const deleteTag = async (id: string) => {
    if (!confirm('Delete this tag?')) return;
    const pb = getPocketBase();
    try { await pb.collection('tags').delete(id); fetchTags(); }
    catch (err) { console.error('Failed to delete:', err); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-secondary">{tags.length} tags total</p>
        <button onClick={() => setEditing({ id: '', name: '', slug: '', description: '' })} className="btn-primary text-xs">+ New Tag</button>
      </div>
      {loading ? <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-bg-soft" />)}</div>
      : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tags.map((tag) => (
            <motion.div key={tag.id} layout className="card flex items-center justify-between rounded-xl p-4">
              <div><p className="font-medium text-text">{tag.name}</p><p className="font-mono text-[10px] text-muted">/{tag.slug}</p></div>
              <div className="flex items-center gap-1">
                <button onClick={() => setEditing(tag)} className="rounded-md p-1.5 text-text-secondary hover:bg-accent/10 hover:text-accent"><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg></button>
                <button onClick={() => deleteTag(tag.id)} className="rounded-md p-1.5 text-text-secondary hover:bg-danger/10 hover:text-danger"><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
              </div>
            </motion.div>
          ))}
        </div>
      }
      <AnimatePresence>
        {editing && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center glass-overlay" onClick={() => setEditing(null)}>
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} onClick={(e) => e.stopPropagation()} className="card w-full max-w-md rounded-2xl p-6">
              <h2 className="mb-6 font-display text-lg font-bold uppercase tracking-wide text-text">{editing.id ? 'Edit Tag' : 'New Tag'}</h2>
              <div className="space-y-4">
                <div><label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">Name</label>
                  <input type="text" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="w-full rounded-lg border border-border bg-bg-soft px-4 py-2.5 text-sm text-text outline-none focus:border-accent" /></div>
                <div><label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">Slug</label>
                  <input type="text" value={editing.slug} onChange={(e) => setEditing({ ...editing, slug: e.target.value })} className="w-full rounded-lg border border-border bg-bg-soft px-4 py-2.5 font-mono text-sm text-text outline-none focus:border-accent" /></div>
                <div><label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">Description</label>
                  <textarea value={editing.description || ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} rows={3} className="w-full rounded-lg border border-border bg-bg-soft px-4 py-2.5 text-sm text-text outline-none focus:border-accent" /></div>
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <button onClick={() => setEditing(null)} className="btn-ghost text-xs">Cancel</button>
                <button onClick={saveTag} disabled={saving} className="btn-primary text-xs">{saving ? 'Saving...' : 'Save Tag'}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
