import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { getPocketBase } from '../../lib/pocketbase';
import { cn } from '../../lib/utils';
import type { Comment } from '../../types/pocketbase';

const statusColors: Record<string, string> = {
  pending: 'bg-warning/15 text-warning border-warning/30',
  approved: 'bg-success/15 text-success border-success/30',
  spam: 'bg-danger/15 text-danger border-red-500/30',
};

export default function CommentModerator() {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'spam'>('pending');

  const fetchComments = useCallback(async () => {
    setLoading(true);
    const pb = getPocketBase();
    try {
      const f = filter === 'all' ? '' : `status = "${filter.replace(/["\\]/g, "")}"`;
      const result = await pb.collection('comments').getList<Comment>(1, 100, { filter: f, sort: '-created', expand: 'post_id' });
      setComments(result.items);
    } catch (err) { console.error('Failed to fetch comments:', err); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { fetchComments(); }, [fetchComments]);

  const updateStatus = async (id: string, status: Comment['status']) => {
    const pb = getPocketBase();
    try { await pb.collection('comments').update(id, { status }); fetchComments(); }
    catch (err) { console.error('Failed to update:', err); }
  };

  const deleteComment = async (id: string) => {
    if (!confirm('Delete this comment permanently?')) return;
    const pb = getPocketBase();
    try { await pb.collection('comments').delete(id); fetchComments(); }
    catch (err) { console.error('Failed to delete:', err); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        {(['pending', 'all', 'approved', 'spam'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={cn('rounded-lg px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-all',
            filter === f ? 'bg-accent/10 text-accent border border-accent/30' : 'text-text-secondary hover:text-text border border-transparent')}>{f}</button>
        ))}
      </div>
      {loading ? <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-bg-soft" />)}</div>
      : comments.length === 0 ? <div className="card rounded-xl p-12 text-center text-text-secondary">No comments found.</div>
      : <div className="space-y-3">
          {comments.map((comment) => (
            <motion.div key={comment.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card rounded-xl p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="font-medium text-text text-sm">{comment.author_name}</span>
                    <span className="font-mono text-[10px] text-muted">{comment.author_email}</span>
                    <span className={'rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase ' + (statusColors[comment.status] || '')}>{comment.status}</span>
                  </div>
                  <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">{comment.content}</p>
                  <div className="mt-2 flex items-center gap-3 text-[10px] font-mono text-muted">
                    <span>{new Date(comment.created).toLocaleString('zh-CN')}</span>
                    {comment.expand?.post_id && <span>on: {((comment.expand?.post_id as unknown as { title?: string } | undefined)?.title) || comment.post_id}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {comment.status !== 'approved' && <button onClick={() => updateStatus(comment.id, 'approved')} className="rounded-md p-1.5 text-text-secondary hover:bg-success/10 hover:text-success" title="Approve">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  </button>}
                  {comment.status !== 'spam' && <button onClick={() => updateStatus(comment.id, 'spam')} className="rounded-md p-1.5 text-text-secondary hover:bg-warning/10 hover:text-warning" title="Mark Spam">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                  </button>}
                  <button onClick={() => deleteComment(comment.id)} className="rounded-md p-1.5 text-text-secondary hover:bg-danger/10 hover:text-danger" title="Delete">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      }
    </div>
  );
}
