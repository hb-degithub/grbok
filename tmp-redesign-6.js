const fs = require('fs');
const path = require('path');

const astroSrc = path.join('H:', '开发', '个人博客', 'astro', 'src');

// CommentSection.tsx - clean design
const commentSection = `import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useComments } from '../../hooks/useComments';
import { CommentItem } from './CommentItem';
import Button from '../ui/Button';
import { CommentForm } from './CommentForm';
import type { CommentFormData } from '../../types/pocketbase';

interface CommentSectionProps {
  postId: string;
}

function SkeletonComment({ delay = 0 }: { delay?: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.3 }} className="card p-5" aria-hidden="true">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-full bg-bg-soft skeleton" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-24 rounded bg-bg-soft" />
          <div className="h-3 w-full rounded bg-bg-soft" />
          <div className="h-3 w-2/3 rounded bg-bg-soft" />
        </div>
      </div>
    </motion.div>
  );
}

export function CommentSection({ postId }: CommentSectionProps) {
  const { comments, loading, error, submitComment, refresh } = useComments(postId);
  const [newCommentIds, setNewCommentIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const allIds = new Set<string>();
    const collectIds = (items: typeof comments) => {
      items.forEach((item) => { allIds.add(item.id); if (item.children.length > 0) collectIds(item.children); });
    };
    collectIds(comments);
    if (allIds.size > 0) {
      setNewCommentIds((prev) => { const newIds = new Set<string>(); allIds.forEach((id) => { if (!prev.has(id)) newIds.add(id); }); return newIds; });
      const timer = setTimeout(() => setNewCommentIds(new Set()), 3000);
      return () => clearTimeout(timer);
    }
  }, [comments]);

  const handleSubmit = async (data: CommentFormData): Promise<boolean> => submitComment(data);

  const countComments = (items: typeof comments): number =>
    items.reduce((acc, item) => acc + 1 + countComments(item.children), 0);
  const totalComments = countComments(comments);

  if (loading) {
    return (
      <section className="space-y-6" aria-busy="true">
        <h2 className="text-xl font-semibold text-text">评论</h2>
        <div className="space-y-3"><SkeletonComment delay={0} /><SkeletonComment delay={0.1} /><SkeletonComment delay={0.2} /></div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="space-y-6">
        <h2 className="text-xl font-semibold text-text">评论</h2>
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} role="alert" className="card flex flex-col items-center justify-center p-10 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-danger/10">
            <svg className="h-6 w-6 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          </div>
          <h3 className="text-base font-medium text-text">加载评论失败</h3>
          <p className="mb-4 text-sm text-text-secondary">{error.message}</p>
          <Button onClick={refresh} variant="primary" size="sm">重试</Button>
        </motion.div>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-text">评论</h2>
        <span className="rounded-full bg-bg-soft px-3 py-1 text-xs font-medium text-text-secondary">{totalComments} 条评论</span>
      </div>
      <CommentForm postId={postId} onSubmit={handleSubmit} />
      <AnimatePresence>
        {comments.length === 0 ? (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="card flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-accent/10">
              <svg className="h-7 w-7 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
            </div>
            <h3 className="text-base font-medium text-text">还没有评论</h3>
            <p className="text-sm text-text-secondary">来发表第一条吧</p>
          </motion.div>
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
            {comments.map((comment) => (
              <CommentItem key={comment.id} comment={comment} onSubmitReply={handleSubmit} isNew={newCommentIds.has(comment.id)} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
`;
fs.writeFileSync(path.join(astroSrc, 'components', 'comments', 'CommentSection.tsx'), commentSection);
console.log('Created CommentSection.tsx');

// CommentForm.tsx - clean design
const commentForm = `import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Button from '../ui/Button';
import Input from '../ui/Input';
import type { CommentFormData } from '../../types/pocketbase';

interface CommentFormProps {
  postId: string;
  onSubmit: (data: CommentFormData) => Promise<boolean>;
}

const textareaClass = 'w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-text placeholder:text-text-muted outline-none transition-all focus:border-accent focus:ring-2 focus:ring-accent/20';

export function CommentForm({ postId, onSubmit }: CommentFormProps) {
  const [formData, setFormData] = useState<CommentFormData>({ author_name: '', author_email: '', content: '', parent_id: null });
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.author_name || !formData.author_email || !formData.content) {
      setStatus('error'); setErrorMessage('请填写所有必填字段'); return;
    }
    setStatus('loading');
    const success = await onSubmit({ ...formData, parent_id: null });
    if (success) {
      setStatus('success');
      setFormData({ author_name: '', author_email: '', content: '', parent_id: null });
      setTimeout(() => setStatus('idle'), 2000);
    } else {
      setStatus('error'); setErrorMessage('提交失败，请重试');
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="card p-5 sm:p-6">
      <AnimatePresence mode="wait">
        {status === 'success' ? (
          <motion.div key="success" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-2 py-6" role="status">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
              <svg className="h-6 w-6 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            </div>
            <p className="font-medium text-success">评论已提交，等待审核</p>
          </motion.div>
        ) : (
          <motion.form key="form" onSubmit={handleSubmit} className="space-y-4">
            <div>
              <h3 className="text-base font-semibold text-text">发表评论</h3>
              <p className="text-xs text-text-secondary">你的邮箱不会被公开显示</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="昵称" placeholder="你的昵称" value={formData.author_name} onChange={(e) => setFormData((p) => ({ ...p, author_name: e.target.value }))} required autoComplete="name" />
              <Input label="邮箱" type="email" placeholder="your@email.com" value={formData.author_email} onChange={(e) => setFormData((p) => ({ ...p, author_email: e.target.value }))} required autoComplete="email" />
            </div>
            <div>
              <label htmlFor="comment-content" className="mb-1.5 block text-sm font-medium text-text">评论内容</label>
              <textarea id="comment-content" value={formData.content} onChange={(e) => { setFormData((p) => ({ ...p, content: e.target.value })); if (status === 'error') setStatus('idle'); }} placeholder="写下你的想法..." rows={4} className={textareaClass} required />
            </div>
            {status === 'error' && (
              <motion.p role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-1.5 text-sm text-danger">
                <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                {errorMessage}
              </motion.p>
            )}
            <Button type="submit" variant="primary" loading={status === 'loading'}>发表评论</Button>
          </motion.form>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
`;
fs.writeFileSync(path.join(astroSrc, 'components', 'comments', 'CommentForm.tsx'), commentForm);
console.log('Created CommentForm.tsx');

// CommentItem.tsx - clean design
const commentItem = `import React, { useState } from 'react';
import { motion } from 'framer-motion';
import type { NestedComment, CommentFormData } from '../../types/pocketbase';
import { ReplyForm } from './ReplyForm';
import { cn } from '../../lib/utils';

interface CommentItemProps {
  comment: NestedComment;
  depth?: number;
  maxDepth?: number;
  onSubmitReply: (data: CommentFormData) => Promise<boolean>;
  isNew?: boolean;
}

export function CommentItem({ comment, depth = 0, maxDepth = 3, onSubmitReply, isNew = false }: CommentItemProps) {
  const [isReplyOpen, setIsReplyOpen] = useState(false);

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return \`\${minutes} 分钟前\`;
    if (hours < 24) return \`\${hours} 小时前\`;
    if (days < 7) return \`\${days} 天前\`;
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  const getAvatarLetter = (name: string) => name.charAt(0).toUpperCase();
  const getAvatarColor = (seed: string) => {
    const colors = ['bg-emerald-500', 'bg-accent', 'bg-warning', 'bg-purple-500', 'bg-pink-500'];
    const hash = Array.from(seed).reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return colors[hash % colors.length];
  };

  const canReply = depth < maxDepth;

  return (
    <motion.article initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className={cn('card p-4 sm:p-5', isNew && 'ring-2 ring-accent/30')}>
      <div className="flex items-start gap-3">
        <div className={cn('flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-white', getAvatarColor(comment.author_name + comment.id))}>
          {getAvatarLetter(comment.author_name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="font-medium text-text">{comment.author_name}</span>
            <span className="text-xs text-text-muted"><time dateTime={comment.created}>{formatTime(comment.created)}</time></span>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">{comment.content}</p>
          {canReply && (
            <button onClick={() => setIsReplyOpen(!isReplyOpen)} className="mt-2 flex items-center gap-1 text-xs font-medium text-text-muted transition-colors hover:text-accent">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
              回复
            </button>
          )}
          <ReplyForm isOpen={isReplyOpen} onClose={() => setIsReplyOpen(false)} onSubmit={onSubmitReply} parentId={comment.id} />
        </div>
      </div>
      {comment.children.length > 0 && (
        <div className="mt-3 space-y-3 border-l-2 border-border pl-4">
          {comment.children.map((child) => (
            <CommentItem key={child.id} comment={child} depth={depth + 1} maxDepth={maxDepth} onSubmitReply={onSubmitReply} />
          ))}
        </div>
      )}
    </motion.article>
  );
}
`;
fs.writeFileSync(path.join(astroSrc, 'components', 'comments', 'CommentItem.tsx'), commentItem);
console.log('Created CommentItem.tsx');

// ReplyForm.tsx - clean design
const replyForm = `import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Button from '../ui/Button';
import Input from '../ui/Input';
import type { CommentFormData } from '../../types/pocketbase';

interface ReplyFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CommentFormData) => Promise<boolean>;
  parentId?: string | null;
}

const textareaClass = 'w-full rounded-md border border-border bg-surface px-4 py-2.5 text-sm text-text placeholder:text-text-muted outline-none transition-all focus:border-accent focus:ring-2 focus:ring-accent/20';

export function ReplyForm({ isOpen, onClose, onSubmit, parentId = null }: ReplyFormProps) {
  const [formData, setFormData] = useState<CommentFormData>({ author_name: '', author_email: '', content: '', parent_id: parentId });
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.author_name || !formData.author_email || !formData.content) {
      setStatus('error'); setErrorMessage('请填写所有必填字段'); return;
    }
    setStatus('loading');
    const success = await onSubmit({ ...formData, parent_id: parentId });
    if (success) {
      setStatus('success');
      setFormData({ author_name: '', author_email: '', content: '', parent_id: parentId });
      setTimeout(() => { setStatus('idle'); onClose(); }, 1500);
    } else {
      setStatus('error'); setErrorMessage('提交失败，请重试');
    }
  };

  const contentId = \`reply-content-\${parentId ?? 'new'}\`;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div initial={{ opacity: 0, height: 0, marginTop: 0 }} animate={{ opacity: 1, height: 'auto', marginTop: 12 }} exit={{ opacity: 0, height: 0, marginTop: 0 }} className="overflow-hidden">
          <form onSubmit={handleSubmit} className="card rounded-md p-4" noValidate>
            {status === 'success' ? (
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center gap-2 py-4" role="status">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-success/10">
                  <svg className="h-5 w-5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                </div>
                <p className="text-sm text-success">回复已提交，等待审核</p>
              </motion.div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Input label="昵称" placeholder="你的昵称" value={formData.author_name} onChange={(e) => setFormData((p) => ({ ...p, author_name: e.target.value }))} required autoComplete="name" />
                  <Input label="邮箱" type="email" placeholder="your@email.com" value={formData.author_email} onChange={(e) => setFormData((p) => ({ ...p, author_email: e.target.value }))} required autoComplete="email" />
                </div>
                <div>
                  <label htmlFor={contentId} className="mb-1.5 block text-sm font-medium text-text">回复内容</label>
                  <textarea id={contentId} value={formData.content} onChange={(e) => { setFormData((p) => ({ ...p, content: e.target.value })); if (status === 'error') setStatus('idle'); }} placeholder="写下你的回复..." rows={3} className={textareaClass} required />
                </div>
                {status === 'error' && <motion.p role="alert" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm text-danger">{errorMessage}</motion.p>}
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={onClose} type="button">取消</Button>
                  <Button variant="primary" size="sm" type="submit" loading={status === 'loading'}>发送回复</Button>
                </div>
              </div>
            )}
          </form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
`;
fs.writeFileSync(path.join(astroSrc, 'components', 'comments', 'ReplyForm.tsx'), replyForm);
console.log('Created ReplyForm.tsx');

// PostLayout.astro - clean design
const postLayout = `---
import BaseLayout from './BaseLayout.astro';
import { sanitizeHtml } from '../lib/security';
import type { Post, User, Tag } from '../types/pocketbase';
import { SITE_CONFIG } from '../config/site';

interface Props {
  post: Post;
  author?: User;
  tags?: Tag[];
}

const { post, author, tags = [] } = Astro.props;
const formattedDate = new Date(post.published_at).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
const wordCount = post.content?.length || 0;
const readingTime = Math.max(1, Math.ceil(wordCount / 300));
const sanitizedContent = typeof sanitizeHtml === 'function' ? sanitizeHtml(post.content) : post.content;
---

<BaseLayout title={post.title} description={post.excerpt} image={post.cover}>
  <article class="mx-auto max-w-4xl px-4 py-8">
    <header class="mb-10">
      <h1 class="mb-6 text-3xl font-bold leading-tight text-text md:text-4xl">{post.title}</h1>
      <div class="flex flex-wrap items-center gap-4 text-sm text-text-secondary">
        {author && (
          <div class="flex items-center gap-2">
            <div class="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold text-white">{author.name?.charAt(0) || '?'}</div>
            <span class="font-medium text-text">{author.name}</span>
          </div>
        )}
        <span class="text-border-strong">|</span>
        <time datetime={post.published_at} class="flex items-center gap-1">
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          {formattedDate}
        </time>
        <span class="flex items-center gap-1">
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          {readingTime} 分钟阅读
        </span>
        <span class="flex items-center gap-1">
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
          {post.views} 次浏览
        </span>
      </div>
      {tags.length > 0 && (
        <div class="mt-5 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <a href={\`/tags/\${tag.slug}\`} class="tag">{tag.name}</a>
          ))}
        </div>
      )}
      {post.cover && (
        <div class="mt-8 overflow-hidden rounded-xl border border-border">
          <img src={post.cover} alt={post.title} class="h-auto w-full object-cover" loading="lazy" />
        </div>
      )}
    </header>

    <div class="prose">
      <div set:html={sanitizedContent} />
    </div>

    <footer class="mt-12 border-t border-border pt-8">
      <div class="flex items-center justify-between">
        <a href="/posts" class="group inline-flex items-center gap-2 text-sm font-medium text-text-secondary transition-colors hover:text-accent">
          <svg class="h-4 w-4 transition-transform group-hover:-translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" /></svg>
          返回文章列表
        </a>
      </div>
    </footer>
  </article>
</BaseLayout>
`;
fs.writeFileSync(path.join(astroSrc, 'layouts', 'PostLayout.astro'), postLayout);
console.log('Created PostLayout.astro');

// login.astro
const loginPage = `---
import BaseLayout from '../layouts/BaseLayout.astro';
import AuthPage from '../components/auth/AuthPage';
---

<BaseLayout title="登录" description="登录到管理后台">
  <AuthPage client:only="react" />
</BaseLayout>
`;
fs.writeFileSync(path.join(astroSrc, 'pages', 'login.astro'), loginPage);
console.log('Created login.astro');

// about.astro
const aboutPage = `---
import BaseLayout from '../layouts/BaseLayout.astro';
import { SITE_CONFIG } from '../config/site';
---

<BaseLayout title="关于" description={\`关于 \${SITE_CONFIG.name}\`}>
  <div class="mx-auto max-w-3xl px-4 py-12 sm:px-6">
    <div class="card p-8 sm:p-10">
      <h1 class="text-2xl font-bold text-text">关于 {SITE_CONFIG.name}</h1>
      <p class="mt-4 text-text-secondary leading-relaxed">{SITE_CONFIG.description}</p>
      <div class="mt-8 space-y-4 text-sm text-text-secondary">
        <p>如果你有任何建议或合作意向，欢迎通过以下方式联系：</p>
        <ul class="list-disc pl-5 space-y-1">
          <li>邮箱：contact@example.com</li>
          <li>GitHub：github.com/example</li>
        </ul>
      </div>
    </div>
  </div>
</BaseLayout>
`;
fs.writeFileSync(path.join(astroSrc, 'pages', 'about.astro'), aboutPage);
console.log('Created about.astro');

// 404.astro
const notFound = `---
import BaseLayout from '../layouts/BaseLayout.astro';
---

<BaseLayout title="页面未找到" description="抱歉，你访问的页面不存在">
  <div class="flex min-h-[60vh] items-center justify-center px-4">
    <div class="card p-10 text-center">
      <h1 class="text-6xl font-bold text-text">404</h1>
      <p class="mt-2 text-text-secondary">抱歉，你访问的页面不存在</p>
      <a href="/" class="btn-primary mt-6 inline-block">返回首页</a>
    </div>
  </div>
</BaseLayout>
`;
fs.writeFileSync(path.join(astroSrc, 'pages', '404.astro'), notFound);
console.log('Created 404.astro');

console.log('Step 8 complete');
