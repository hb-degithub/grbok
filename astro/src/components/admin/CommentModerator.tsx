import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { getPocketBase } from '../../lib/pocketbase';
import { cn } from '../../lib/utils';
import type { Comment } from '../../types/pocketbase';

type CommentFilter = 'all' | 'pending' | 'approved' | 'spam';

const statusColors: Record<string, string> = {
  pending: 'bg-warning/15 text-warning border-warning/30',
  approved: 'bg-success/15 text-success border-success/30',
  spam: 'bg-danger/15 text-danger border-red-500/30',
};

const statusLabels: Record<string, string> = { pending: '待审核', approved: '已通过', spam: '垃圾评论' };
const filterLabels: Record<CommentFilter, string> = { pending: '待审核', all: '全部', approved: '已通过', spam: '垃圾评论' };

function getPostTitle(comment: Comment) {
  return ((comment.expand?.post_id as unknown as { title?: string } | undefined)?.title) || comment.post_id;
}

export default function CommentModerator() {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<CommentFilter>('pending');
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };
  const batchAction = async (action: 'approved' | 'spam', label: string) => {
    if (selectedIds.length === 0) return;
    if (!confirm('确定' + label + selectedIds.length + '条评论吗？')) return;
    const pb = getPocketBase();
    try {
      await Promise.all(selectedIds.map(id => pb.collection('comments').update(id, { status: action })));
      setSelectedIds([]); fetchComments();
    } catch (err) { console.error(err); }
  };
  const batchDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm('确定删除' + selectedIds.length + '条评论吗？不可撤销。')) return;
    const pb = getPocketBase();
    try {
      await Promise.all(selectedIds.map(id => pb.collection('comments').delete(id)));
      setSelectedIds([]); fetchComments();
    } catch (err) { console.error(err); }
  };
  const riskHints = (comment: Comment) => {
    const hints: string[] = [];
    if (comment.content && /https?:\/\/[^\s]{4,}/i.test(comment.content)) hints.push('含链接');
    if (comment.author_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(comment.author_email)) hints.push('邮箱异常');
    if (comment.content && comment.content.length < 10) hints.push('内容过短');
    return hints;
  };

  const fetchComments = useCallback(async () => {
    setLoading(true);
    const pb = getPocketBase();
    try {
      const f = filter === 'all' ? '' : `status = "${filter}"`;
      const result = await pb.collection('comments').getList<Comment>(1, 100, { filter: f, sort: '-created', expand: 'post_id' });
      setComments(result.items);
    } catch (err) {
      console.error('获取评论失败：', err);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { fetchComments(); }, [fetchComments]);

  const counts = useMemo(() => ({
    all: comments.length,
    pending: comments.filter((comment) => comment.status === 'pending').length,
    approved: comments.filter((comment) => comment.status === 'approved').length,
    spam: comments.filter((comment) => comment.status === 'spam').length,
  }), [comments]);

  const filteredComments = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return comments;
    return comments.filter((comment) => [comment.author_name, comment.author_email, comment.content, getPostTitle(comment)].some((value) => String(value || '').toLowerCase().includes(keyword)));
  }, [comments, query]);

  const updateStatus = async (id: string, status: Comment['status']) => {
    const pb = getPocketBase();
    try {
      await pb.collection('comments').update(id, { status });
      fetchComments();
    } catch (err) {
      console.error('更新评论状态失败：', err);
    }
  };

  const deleteComment = async (id: string) => {
    if (!confirm('确定永久删除这条评论吗？')) return;
    const pb = getPocketBase();
    try {
      await pb.collection('comments').delete(id);
      fetchComments();
    } catch (err) {
      console.error('删除评论失败：', err);
    }
  };

  return (
    <div className="min-w-0 space-y-4">
      <section className="card max-w-full overflow-hidden rounded-md p-3 shadow-xs sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          {(['pending', 'all', 'approved', 'spam'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn('min-h-10 flex-1 basis-[calc(50%-0.25rem)] rounded-md border px-3 py-2 text-xs transition-all sm:flex-none sm:basis-auto',
                filter === f ? 'border-accent/30 bg-accent/10 text-accent' : 'border-transparent text-text-secondary hover:border-border hover:bg-bg-soft hover:text-text')}
            >
              <span className="break-words [overflow-wrap:anywhere]">{filterLabels[f]}</span> <span className="ml-1 font-mono text-[10px] text-muted">{counts[f]}</span>
            </button>
          ))}
          <div className="hidden min-w-[220px] flex-1 sm:block" />
          <label className="relative w-full sm:w-80">
            <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 21l-4.35-4.35M11 18a7 7 0 110-14 7 7 0 010 14z" /></svg>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索作者、邮箱、内容、文章" className="h-10 w-full min-w-0 rounded-md border border-border bg-bg-soft pl-9 pr-3 text-sm text-text outline-none transition focus:border-accent focus:bg-white" />
          </label>
        </div>
      </section>

      {loading ? <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-md border border-border bg-white" />)}</div>
      : filteredComments.length === 0 ? <div className="card rounded-md p-6 text-center text-sm text-text-secondary sm:p-12">没有找到评论。</div>
      : <div className="space-y-2">
          {filteredComments.map((comment) => (
            <motion.article key={comment.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card max-w-full overflow-hidden rounded-md p-3 shadow-xs sm:p-4">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_120px]">
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="flex items-center gap-2"><input type="checkbox" checked={selectedIds.includes(comment.id)} onChange={() => toggleSelect(comment.id)} className="h-4 w-4 rounded border-border accent-accent" /> <span className="break-words text-sm font-semibold text-text [overflow-wrap:anywhere]">{comment.author_name}</span></span>
                    <span className="break-all font-mono text-[10px] text-muted">{comment.author_email}</span>
                    <span className={'rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase ' + (statusColors[comment.status] || '')}>{statusLabels[comment.status] || comment.status}</span>
                            {riskHints(comment).map(hint => <span key={hint} className="rounded-md border border-warning/25 bg-warning/10 px-2 py-0.5 font-mono text-[10px] text-warning ml-1">{hint}</span>)}
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm leading-6 text-text-secondary [overflow-wrap:anywhere]">{comment.content}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2 font-mono text-[10px] text-muted">
                    <span className="break-words [overflow-wrap:anywhere]">{new Date(comment.created).toLocaleString('zh-CN')}</span>
                    <span className="break-words [overflow-wrap:anywhere]">文章：{getPostTitle(comment)}</span>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:items-start sm:justify-start lg:flex-col lg:items-stretch lg:justify-end">
                  {comment.status !== 'approved' && <button onClick={() => updateStatus(comment.id, 'approved')} className="inline-flex min-h-10 min-w-10 items-center justify-center gap-2 rounded-md border border-success/25 bg-success/10 px-3 text-xs text-success hover:bg-success/15" title="通过">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg><span className="max-lg:hidden">通过</span>
                  </button>}
                  {comment.status !== 'spam' && <button onClick={() => updateStatus(comment.id, 'spam')} className="inline-flex min-h-10 min-w-10 items-center justify-center gap-2 rounded-md border border-warning/25 bg-warning/10 px-3 text-xs text-warning hover:bg-warning/15" title="标记垃圾评论">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg><span className="max-lg:hidden">垃圾</span>
                  </button>}
                  <button onClick={() => deleteComment(comment.id)} className="inline-flex min-h-10 min-w-10 items-center justify-center gap-2 rounded-md border border-danger/25 bg-danger/10 px-3 text-xs text-danger hover:bg-danger/15" title="删除">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg><span className="max-lg:hidden">删除</span>
                  </button>
                </div>
              </div>
            </motion.article>
          ))}
        </div>
      }
    </div>
  );
}
