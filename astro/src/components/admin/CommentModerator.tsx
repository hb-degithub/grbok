import React, { useEffect, useState } from 'react';
import { motion, type Variants } from 'framer-motion';
import { useAdminComments, type CommentFilter } from '../../hooks/domains/useAdminComments';
import { useAdminAuth } from '../../hooks/useAdminAuth';
import { cn } from '../../lib/utils';
import ConfirmDialog from '../ui/ConfirmDialog';
import { showToast } from '../ui/Toast';
import { describePbError } from '../../lib/pb-error';
import { adminCommentService, type Comment } from '../../lib/services/adminCommentService';
import { getAiSettings, type AiSettings } from '../../lib/services/aiSettingsService';
import { moderateComment, replyComment } from '../../lib/services/aiAssistService';

const statusColors: Record<string, string> = {
  pending: 'bg-warning/15 text-warning border-warning/30',
  approved: 'bg-success/15 text-success border-success/30',
  spam: 'bg-danger/15 text-danger border-red-500/30',
};

const statusLabels: Record<string, string> = { pending: '待审核', approved: '已通过', spam: '垃圾评论' };
const filterLabels: Record<CommentFilter, string> = { pending: '待审核', all: '全部', approved: '已通过', spam: '垃圾评论', ai: 'AI 回复' };

/** AI 审核结论徽章：approve=绿 / spam=红 / unsure=黄 / error=灰 */
const verdictConfig: Record<string, { label: string; className: string }> = {
  approve: { label: 'AI:通过', className: 'border-success/30 bg-success/10 text-success' },
  spam: { label: 'AI:垃圾', className: 'border-danger/30 bg-danger/10 text-danger' },
  unsure: { label: 'AI:存疑', className: 'border-warning/30 bg-warning/10 text-warning' },
  error: { label: 'AI:失败', className: 'border-border bg-bg-soft text-muted' },
};

/** AI 评论管家档位（状态条展示） */
const commentModeLabels: Record<string, string> = { off: '关闭', manual: '仅建议', assist: '半自动', full_auto: '全自动' };

/** 手动触发 AI 回复被跳过时的原因映射 */
const replySkipLabels: Record<string, string> = {
  'existing-ai-child': '该评论已有 AI 回复',
  'ai-ancestor': '父链中已有 AI 回复（防循环）',
  'depth-limit': '嵌套深度已达上限',
  'post-author': '文章作者本人的评论',
  backlog: '历史评论不自动回复',
  'missing-post': '所属文章不存在',
  state: '当前状态不可回复',
};

const listVariants: Variants = {
  hidden: { opacity: 1 },
  visible: { transition: { staggerChildren: 0.04 } }
};
const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] } }
};

function getPostTitle(comment: Comment) {
  return comment.expand?.post?.title || comment.post;
}

export default function CommentModerator() {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmState, setConfirmState] = useState<{ open: boolean; title: string; message: string; onConfirm: () => void }>({ open: false, title: '', message: '', onConfirm: () => {} });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [savingContent, setSavingContent] = useState(false);
  const { comments, loading, filter, setFilter, query, setQuery, page, setPage, totalPages, updateStatus, refresh, deleteComment, batchUpdateStatus, batchDelete } = useAdminComments();

  // AI 状态条（仅 super_admin 可见；非超管/未配置时静默隐藏）
  const { role } = useAdminAuth();
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null);
  const [aiBusy, setAiBusy] = useState<string | null>(null);

  useEffect(() => {
    if (role !== 'super_admin') return;
    let cancelled = false;
    getAiSettings()
      .then((s) => { if (!cancelled) setAiSettings(s); })
      .catch(() => { /* 无权读取或未配置时隐藏状态条 */ });
    return () => { cancelled = true; };
  }, [role]);

  /** 行内手动触发单条 AI 审核（pending 评论；已有结论时为重审） */
  const handleAiModerate = async (comment: Comment) => {
    if (aiBusy) return;
    setAiBusy(comment.id + ':moderate');
    try {
      const result = await moderateComment(comment.id);
      const label = verdictConfig[result.verdict]?.label || result.verdict;
      showToast('AI 审核完成：' + label + (result.reason ? '（' + result.reason + '）' : ''), result.verdict === 'error' ? 'error' : 'success');
      void refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'AI 审核失败', 'error');
    } finally {
      setAiBusy(null);
    }
  };

  /** 行内手动触发单条 AI 回复（approved 非 AI 评论；不受 worker 72h 守卫限制） */
  const handleAiReply = async (comment: Comment) => {
    if (aiBusy) return;
    setAiBusy(comment.id + ':reply');
    try {
      const result = await replyComment(comment.id);
      if (result.outcome === 'created') {
        showToast(result.status === 'approved' ? 'AI 回复已直接发出' : 'AI 回复草稿已生成，请到「AI 回复」页签确认', 'success');
        void refresh();
      } else if (result.outcome === 'skipped') {
        showToast(replySkipLabels[result.reason] || '已跳过：' + result.reason, 'info');
      } else {
        showToast('AI 回复生成失败' + (result.reason ? '：' + result.reason : ''), 'error');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'AI 回复失败', 'error');
    } finally {
      setAiBusy(null);
    }
  };

  const startEditContent = (comment: Comment) => {
    setEditingId(comment.id);
    setEditContent(comment.content);
  };

  const cancelEditContent = () => {
    setEditingId(null);
    setEditContent('');
  };

  const saveContent = async (id: string) => {
    const next = editContent.trim();
    if (!next || savingContent) return;
    setSavingContent(true);
    try {
      await adminCommentService.updateContent(id, next);
      showToast('已保存', 'success');
      cancelEditContent();
      void refresh();
    } catch (err) {
      showToast(describePbError(err, '保存失败'), 'error');
    } finally {
      setSavingContent(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleBatchAction = (action: 'approved' | 'spam', label: string) => {
    if (selectedIds.length === 0) return;
    setConfirmState({ open: true, title: '确认操作', message: '确定' + label + selectedIds.length + '条评论吗？', onConfirm: async () => {
      await batchUpdateStatus(selectedIds, action);
      setSelectedIds([]);
    }});
  };

  const handleBatchDelete = () => {
    if (selectedIds.length === 0) return;
    setConfirmState({ open: true, title: '确认删除', message: '确定删除' + selectedIds.length + '条评论吗？不可撤销。', onConfirm: async () => {
      await batchDelete(selectedIds);
      setSelectedIds([]);
    }});
  };

  const handleDeleteComment = (id: string) => {
    setConfirmState({ open: true, title: '确认删除', message: '确定永久删除这条评论吗？', onConfirm: async () => {
      await deleteComment(id);
    }});
  };

  const riskHints = (comment: Comment) => {
    const hints: string[] = [];
    if (comment.content && /https?:\/\/[^\s]{4,}/i.test(comment.content)) hints.push('含链接');
    if (comment.author_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(comment.author_email)) hints.push('邮箱异常');
    if (comment.content && comment.content.length < 10) hints.push('内容过短');
    return hints;
  };

  const pageLabel = `第 ${page}/${Math.max(totalPages, 1)} 页 · ${comments.length} 条`;

  return (
    <div className="min-w-0 space-y-4">
      {role === 'super_admin' && aiSettings && (
        <section className="card flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md px-3 py-2 text-xs sm:px-4">
          <span className="font-medium text-text">AI 管家</span>
          <span className={aiSettings.enabled && aiSettings.has_key ? 'text-success' : 'text-text-secondary'}>
            {aiSettings.enabled && aiSettings.has_key ? '已启用' : '未启用'}
          </span>
          <span className="text-text-secondary">模式：{commentModeLabels[aiSettings.comment_mode] || aiSettings.comment_mode}</span>
          <span className="text-text-secondary">
            违禁词：{aiSettings.banned_words_enabled ? `拦截中（${aiSettings.banned_words.length} 词）` : '关闭'}
          </span>
          <a href="/admin/ai" className="text-accent hover:underline">AI 设置</a>
        </section>
      )}
      <section className="card max-w-full overflow-hidden rounded-md p-3 shadow-xs sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          {(['pending', 'all', 'approved', 'spam', 'ai'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn('min-h-10 flex-1 basis-[calc(50%-0.25rem)] rounded-md border px-3 py-2 text-xs transition-all sm:flex-none sm:basis-auto',
                filter === f ? 'border-accent/30 bg-accent/10 text-accent' : 'border-transparent text-text-secondary hover:border-border hover:bg-bg-soft hover:text-text')}
            >
              <span className="break-words [overflow-wrap:anywhere]">{filterLabels[f]}</span>
            </button>
          ))}
          <span className="hidden font-mono text-[10px] text-muted sm:inline">{pageLabel}</span>
          <div className="hidden min-w-[120px] flex-1 sm:block" />
          <label className="relative w-full sm:w-80">
            <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 21l-4.35-4.35M11 18a7 7 0 110-14 7 7 0 010 14z" /></svg>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索作者、邮箱、内容、文章" className="h-10 w-full min-w-0 rounded-md border border-border bg-bg-soft pl-9 pr-3 text-sm text-text outline-none transition focus:border-accent focus:bg-white" />
          </label>
        </div>
      </section>

      {loading ? <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-md border border-border bg-white" />)}</div>
      : comments.length === 0 ? <div className="card rounded-md p-6 text-center text-sm text-text-secondary sm:p-12">{query ? '没有匹配的评论。' : '没有找到评论。'}</div>
      : <motion.div variants={listVariants} initial="hidden" animate="visible" className="space-y-2">
          {comments.map((comment) => (
            <motion.article key={comment.id} layout variants={itemVariants} className="card max-w-full overflow-hidden rounded-md p-3 shadow-xs sm:p-4">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_120px]">
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="flex items-center gap-2"><input type="checkbox" checked={selectedIds.includes(comment.id)} onChange={() => toggleSelect(comment.id)} className="h-4 w-4 rounded border-border accent-accent" /> <span className="break-words text-sm font-semibold text-text [overflow-wrap:anywhere]">{comment.author_name}</span></span>
                    <span className="break-all font-mono text-[10px] text-muted">{comment.author_email}</span>
                    <span className={'rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase ' + (statusColors[comment.status] || '')}>{statusLabels[comment.status] || comment.status}</span>
                    {comment.is_ai && <span className="rounded-md border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-[10px] text-accent" title="由 AI 生成的回复">AI</span>}
                    {comment.ai_verdict && verdictConfig[comment.ai_verdict] && (
                      <span className="inline-flex min-w-0 flex-col gap-0.5">
                        <span className={'w-fit rounded-md border px-2 py-0.5 font-mono text-[10px] ' + verdictConfig[comment.ai_verdict].className} title={comment.ai_reason || undefined}>{verdictConfig[comment.ai_verdict].label}</span>
                        {comment.ai_reason && <span className="max-w-[220px] truncate text-[10px] text-muted" title={comment.ai_reason}>{comment.ai_reason}</span>}
                      </span>
                    )}
                            {riskHints(comment).map(hint => <span key={hint} className="rounded-md border border-warning/25 bg-warning/10 px-2 py-0.5 font-mono text-[10px] text-warning ml-1">{hint}</span>)}
                  </div>
                  {editingId === comment.id ? (
                    <div className="space-y-2">
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={3}
                        maxLength={2000}
                        className="w-full rounded-md border border-border bg-bg-soft px-3 py-2 text-sm text-text outline-none transition focus:border-accent focus:bg-white"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <button onClick={() => saveContent(comment.id)} disabled={!editContent.trim() || savingContent} className="inline-flex h-8 items-center rounded-md border border-accent/30 bg-accent/10 px-3 text-xs text-accent transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-40">{savingContent ? '保存中…' : '保存'}</button>
                        <button onClick={cancelEditContent} disabled={savingContent} className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs text-text-secondary transition-colors hover:border-border-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-40">取消</button>
                      </div>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap break-words text-sm leading-6 text-text-secondary [overflow-wrap:anywhere]">{comment.content}</p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2 font-mono text-[10px] text-muted">
                    <span className="break-words [overflow-wrap:anywhere]">{new Date(comment.created).toLocaleString('zh-CN')}</span>
                    <span className="break-words [overflow-wrap:anywhere]">文章：{getPostTitle(comment)}</span>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:items-start sm:justify-start lg:flex-col lg:items-stretch lg:justify-end">
                  {comment.status === 'pending' && (
                    <button
                      onClick={() => handleAiModerate(comment)}
                      disabled={aiBusy !== null}
                      className="inline-flex min-h-10 min-w-10 items-center justify-center gap-2 rounded-md border border-accent/25 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/15 disabled:opacity-50"
                      title={comment.ai_verdict ? '重新执行 AI 审核' : '立即执行 AI 审核'}
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" /></svg>
                      <span className="max-lg:hidden">{aiBusy === comment.id + ':moderate' ? '处理中' : comment.ai_verdict ? 'AI 重审' : 'AI 审核'}</span>
                    </button>
                  )}
                  {comment.status === 'approved' && !comment.is_ai && (
                    <button
                      onClick={() => handleAiReply(comment)}
                      disabled={aiBusy !== null}
                      className="inline-flex min-h-10 min-w-10 items-center justify-center gap-2 rounded-md border border-accent/25 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/15 disabled:opacity-50"
                      title="生成 AI 回复"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h8m-8 4h5m-9 6l-3 3V6a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2H7z" /></svg>
                      <span className="max-lg:hidden">{aiBusy === comment.id + ':reply' ? '生成中' : 'AI 回复'}</span>
                    </button>
                  )}
                  {comment.status !== 'approved' && <button onClick={() => updateStatus(comment.id, 'approved')} className="inline-flex min-h-10 min-w-10 items-center justify-center gap-2 rounded-md border border-success/25 bg-success/10 px-3 text-xs text-success hover:bg-success/15" title="通过">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg><span className="max-lg:hidden">通过</span>
                  </button>}
                  {comment.status !== 'spam' && <button onClick={() => updateStatus(comment.id, 'spam')} className="inline-flex min-h-10 min-w-10 items-center justify-center gap-2 rounded-md border border-warning/25 bg-warning/10 px-3 text-xs text-warning hover:bg-warning/15" title="标记垃圾评论">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg><span className="max-lg:hidden">垃圾</span>
                  </button>}
                  {comment.is_ai && comment.status === 'pending' && editingId !== comment.id && <button onClick={() => startEditContent(comment)} className="inline-flex min-h-10 min-w-10 items-center justify-center gap-2 rounded-md border border-accent/25 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/15" title="编辑 AI 回复草稿">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg><span className="max-lg:hidden">编辑</span>
                  </button>}
                  <button onClick={() => handleDeleteComment(comment.id)} className="inline-flex min-h-10 min-w-10 items-center justify-center gap-2 rounded-md border border-danger/25 bg-danger/10 px-3 text-xs text-danger hover:bg-danger/15" title="删除">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg><span className="max-lg:hidden">删除</span>
                  </button>
                </div>
              </div>
            </motion.article>
          ))}
        </motion.div>
      }

      {totalPages > 1 && (
        <nav className="flex flex-wrap items-center justify-center gap-2" aria-label="评论分页">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="inline-flex h-10 min-w-10 items-center justify-center rounded-md border border-border bg-white px-3 text-sm text-text-secondary transition-colors hover:border-border-hover disabled:cursor-not-allowed disabled:opacity-40">上一页</button>
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
            .map((p, idx, arr) => (
              <span key={p} className="flex items-center gap-1">
                {idx > 0 && arr[idx - 1] !== p - 1 && <span className="px-1 text-muted">…</span>}
                <button onClick={() => setPage(p)} aria-current={page === p ? 'page' : undefined} className={cn('inline-flex h-10 min-w-10 items-center justify-center rounded-md border px-3 text-sm font-medium transition-all', page === p ? 'border-accent/30 bg-accent/10 text-accent' : 'border-border bg-white text-text-secondary hover:border-border-hover hover:text-text')}>{p}</button>
              </span>
            ))}
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="inline-flex h-10 min-w-10 items-center justify-center rounded-md border border-border bg-white px-3 text-sm text-text-secondary transition-colors hover:border-border-hover disabled:cursor-not-allowed disabled:opacity-40">下一页</button>
        </nav>
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