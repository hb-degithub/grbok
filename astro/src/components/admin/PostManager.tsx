import React, { useState, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import { useAdminPosts } from '../../hooks/domains/useAdminPosts';
import { useAiAssist } from '../../hooks/domains/useAiAssist';
import { cn } from '../../lib/utils';
import { sanitizeHtml } from '../../lib/security';
import { showToast } from '../ui/Toast';
import ConfirmDialog from '../ui/ConfirmDialog';
import MediaLibrary from './MediaLibrary';
import AiArticleGenerator from './AiArticleGenerator';
import { mediaService } from '../../lib/services/mediaService';
import { adminPostService, type Post } from '../../lib/services/adminPostService';
import type { AssistMetaResult } from '../../lib/services/aiAssistService';

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
const itemVariants: Variants = {
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
    fetchPosts,
    updateStatus,
    deletePost,
    savePost,
  } = useAdminPosts();

  const [confirmState, setConfirmState] = useState<{ open: boolean; title: string; message: string; onConfirm: () => void }>({ open: false, title: '', message: '', onConfirm: () => {} });
  const [showMediaLibrary, setShowMediaLibrary] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [showAiGenerator, setShowAiGenerator] = useState(false);
  const [metaResult, setMetaResult] = useState<AssistMetaResult | null>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const { assisting, runMeta, runPolish, runContinue } = useAiAssist();

  // 粘贴/拖拽图片到正文：上传到媒体库后在光标处插入 Markdown 图片语法。
  // 插入 1024x0 缩略图（白名单见 pb_migrations/20260912000000），原图不直接进正文。
  const uploadAndInsertImage = async (file: File, textarea: HTMLTextAreaElement) => {
    const insertAt = textarea.selectionStart ?? Number.MAX_SAFE_INTEGER;
    setImageUploading(true);
    try {
      const asset = await mediaService.uploadAsset(file);
      const url = mediaService.getFileUrl(asset, '1024x0');
      const snippet = `\n![${asset.alt || file.name}](${url})\n`;
      // 上传期间用户可能继续输入，必须用函数式更新避免覆盖新内容
      setEditing((prev) => {
        if (!prev) return prev;
        const content = prev.content || '';
        const at = Math.min(insertAt, content.length);
        return { ...prev, content: content.slice(0, at) + snippet + content.slice(at) };
      });
      setDirty(true);
      showToast('图片已上传并插入正文', 'success');
    } catch (err) {
      showToast(err instanceof Error ? `图片上传失败：${err.message}` : '图片上传失败', 'error');
    } finally {
      setImageUploading(false);
    }
  };

  const pickImageFiles = (files: FileList | File[] | null): File[] => {
    if (!files) return [];
    return Array.from(files).filter((f) => f.type.startsWith('image/'));
  };

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

  // ---------- AI 辅助写作 ----------

  const editingOpen = editing !== null;
  useEffect(() => {
    if (!editingOpen) setMetaResult(null);
  }, [editingOpen]);

  /** 回填单个字段并标记未保存（弹窗关闭时会清空 AI 建议） */
  const patchEditing = (patch: Partial<Post>) => {
    setEditing((prev) => (prev ? ({ ...prev, ...patch } as Post) : prev));
    setDirty(true);
  };

  /** 在正文 [start, end) 区间写入 text；函数式更新避免覆盖异步等待期间的新输入 */
  const replaceContentRange = (start: number, end: number, text: string) => {
    setEditing((prev) => {
      if (!prev) return prev;
      const content = prev.content || '';
      const from = Math.max(0, Math.min(start, content.length));
      const to = Math.max(from, Math.min(end, content.length));
      return { ...prev, content: content.slice(0, from) + text + content.slice(to) };
    });
    setDirty(true);
  };

  /** 取正文 textarea 当前选区（两个下标相等表示无选区） */
  const readSelection = () => {
    const el = contentRef.current;
    const content = editing?.content || '';
    const start = el?.selectionStart ?? 0;
    const end = el?.selectionEnd ?? 0;
    return { content, start, end, selected: end > start ? content.slice(start, end) : '' };
  };

  const handleAiMeta = async () => {
    if (!editing) return;
    if (!editing.title?.trim() && !editing.content?.trim()) {
      showToast('请先填写标题或正文，AI 才能给出建议', 'error');
      return;
    }
    try {
      const result = await runMeta(editing.title || '', editing.content || '');
      setMetaResult(result);
      showToast('已生成标题与摘要建议，点击即可回填', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'AI 生成失败', 'error');
    }
  };

  // 列表行"AI 优化"：直接打开该文的编辑弹窗并对其跑 meta 建议（无需先点编辑再点工具条）
  const handleAiOptimize = async (post: Post) => {
    setEditing(post);
    setDirty(false);
    setMetaResult(null);
    if (!post.title?.trim() && !post.content?.trim()) {
      showToast('该文缺少标题与正文，AI 无法给出建议', 'info');
      return;
    }
    try {
      const result = await runMeta(post.title || '', post.content || '');
      setMetaResult(result);
      showToast('已生成标题与摘要建议，点击即可回填', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'AI 生成失败', 'error');
    }
  };

  const handleAiPolish = async () => {
    if (!editing) return;
    const { start, end, selected } = readSelection();
    if (!selected.trim()) {
      showToast('请先在正文中选中要润色的文字', 'error');
      return;
    }
    try {
      const { text } = await runPolish(selected);
      replaceContentRange(start, end, text);
      showToast('已用 AI 润色结果替换选中文字', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'AI 润色失败', 'error');
    }
  };

  const handleAiContinue = async () => {
    if (!editing) return;
    const { content, start, end, selected } = readSelection();
    if (!content.trim()) {
      showToast('请先填写正文内容，AI 才能续写', 'error');
      return;
    }
    const hasSelection = !!contentRef.current && end > start;
    // 有选区时以选区为锚点，否则用文末 200 字作为上下文
    const anchor = hasSelection ? selected : content.slice(-200);
    try {
      const { text } = await runContinue(content, anchor);
      // 有选区插到选区之后，无选区追加到文末
      const at = hasSelection ? end : content.length;
      replaceContentRange(at, at, text);
      showToast('已插入 AI 续写内容', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'AI 续写失败', 'error');
    }
  };

  const handleApplyTitle = (title: string) => {
    patchEditing({ title });
    showToast('已回填标题', 'success');
  };

  const applyExcerpt = (excerpt: string) => {
    patchEditing({ excerpt });
    showToast('已回填摘要', 'success');
  };

  const handleApplyExcerpt = () => {
    const excerpt = metaResult?.excerpt || '';
    if (!excerpt) return;
    // 已有内容时先确认，避免覆盖人工撰写的结果
    if ((editing?.excerpt || '').trim()) {
      setConfirmState({
        open: true,
        title: '覆盖摘要',
        message: '摘要已有内容，确定用 AI 建议覆盖吗？',
        onConfirm: () => applyExcerpt(excerpt),
      });
      return;
    }
    applyExcerpt(excerpt);
  };

  // 按 name 忽略大小写匹配现有标签，命中的并入已选标签（不改动未命中的项）
  const handleApplyTags = () => {
    const names = metaResult?.tag_names || [];
    if (names.length === 0) return;
    const normalized = names.map((name) => name.trim().toLowerCase());
    const matched = allTags.filter((tag) => normalized.includes(tag.name.trim().toLowerCase()));
    if (matched.length === 0) {
      showToast('AI 建议的标签未匹配到现有标签', 'info');
      return;
    }
    const toAdd = matched.filter((tag) => !selectedTagIds.includes(tag.id)).map((tag) => tag.id);
    if (toAdd.length === 0) {
      showToast('AI 建议的标签已在选中列表中', 'info');
      return;
    }
    setSelectedTagIds([...selectedTagIds, ...toAdd]);
    setDirty(true);
    showToast(`已并入 ${toAdd.length} 个标签`, 'success');
  };

  const handleApplySeoDescription = () => {
    const seoDescription = metaResult?.seo_description || '';
    if (!seoDescription) return;
    patchEditing({ seo_description: seoDescription });
    showToast('已回填 SEO 描述', 'success');
  };

  // AI 生成成功后按 id 取回完整文章（含正文）打开编辑弹窗供人工审阅；
  // 取回失败则仅刷新列表，文章已在服务端落库，不会丢。
  const handleAiCreated = async (created: { id: string }) => {
    try {
      const full = await adminPostService.getPostById(created.id);
      setEditing(full);
      setDirty(false);
    } catch (err) {
      console.error('获取 AI 生成文章失败:', err);
      showToast('文章已生成，正在刷新列表', 'warning');
      fetchPosts();
    }
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
            <button
              onClick={() => setShowAiGenerator(true)}
              className="btn-ghost min-h-10 px-4 text-xs"
              title="用 AI 依据主题与大纲生成草稿"
            >
              ✨ AI 生成
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
                    {post.is_ai && (
                      <span
                        className="rounded-md border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-[10px] uppercase text-accent"
                        title="本文由 AI 一键成文创建"
                      >
                        AI 生成
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
                    onClick={() => handleAiOptimize(post)}
                    disabled={assisting !== null}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-md text-text-secondary hover:bg-accent/10 hover:text-accent disabled:opacity-50"
                    title="AI 优化（生成标题/摘要/标签建议）"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                    </svg>
                  </button>
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

              {/* AI 工具条：三个动作共用 assisting 状态防重入 */}
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted">AI</span>
                <button
                  onClick={handleAiMeta}
                  disabled={assisting !== null}
                  className="btn-ghost min-h-8 px-3 text-xs disabled:opacity-50"
                >
                  {assisting === 'meta' ? '生成中…' : 'AI 标题/摘要/标签'}
                </button>
                <button
                  onClick={handleAiPolish}
                  disabled={assisting !== null}
                  className="btn-ghost min-h-8 px-3 text-xs disabled:opacity-50"
                >
                  {assisting === 'polish' ? '生成中…' : 'AI 润色'}
                </button>
                <button
                  onClick={handleAiContinue}
                  disabled={assisting !== null}
                  className="btn-ghost min-h-8 px-3 text-xs disabled:opacity-50"
                >
                  {assisting === 'continue' ? '生成中…' : 'AI 续写'}
                </button>
              </div>

              {metaResult && (
                <div className="mb-4 space-y-3 rounded-lg border border-accent/25 bg-accent/5 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-accent">AI 建议</span>
                    <button
                      onClick={() => setMetaResult(null)}
                      className="min-h-8 rounded-md px-2 text-xs text-text-secondary hover:bg-accent/10"
                    >
                      收起
                    </button>
                  </div>

                  {metaResult.titles.length > 0 && (
                    <div>
                      <div className="mb-1.5 text-xs text-text-secondary">候选标题（点击回填）</div>
                      <div className="flex flex-wrap gap-2">
                        {metaResult.titles.map((title, i) => (
                          <button
                            key={`${i}-${title}`}
                            onClick={() => handleApplyTitle(title)}
                            className="rounded-md border border-border bg-bg-soft px-3 py-1.5 text-left text-xs text-text hover:border-accent hover:text-accent"
                          >
                            {title}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {metaResult.excerpt && (
                    <div>
                      <div className="mb-1.5 text-xs text-text-secondary">摘要</div>
                      <p className="text-xs leading-5 text-text">{metaResult.excerpt}</p>
                      <button
                        onClick={handleApplyExcerpt}
                        className="btn-ghost mt-2 min-h-8 px-3 text-xs"
                      >
                        回填摘要
                      </button>
                    </div>
                  )}

                  {metaResult.tag_names.length > 0 && (
                    <div>
                      <div className="mb-1.5 text-xs text-text-secondary">建议标签</div>
                      <div className="flex flex-wrap gap-1.5">
                        {metaResult.tag_names.map((name, i) => (
                          <span
                            key={`${i}-${name}`}
                            className="rounded-full bg-bg-soft px-2.5 py-0.5 text-xs text-text-secondary"
                          >
                            {name}
                          </span>
                        ))}
                      </div>
                      <button
                        onClick={handleApplyTags}
                        className="btn-ghost mt-2 min-h-8 px-3 text-xs"
                      >
                        并入已选标签
                      </button>
                    </div>
                  )}

                  {metaResult.seo_description && (
                    <div>
                      <div className="mb-1.5 text-xs text-text-secondary">SEO 描述</div>
                      <p className="text-xs leading-5 text-text">{metaResult.seo_description}</p>
                      <button
                        onClick={handleApplySeoDescription}
                        className="btn-ghost mt-2 min-h-8 px-3 text-xs"
                      >
                        回填 SEO 描述
                      </button>
                    </div>
                  )}
                </div>
              )}
              
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
                  ref={contentRef}
                  value={editing.content || ''}
                  onChange={(e) => { setEditing({ ...editing, content: e.target.value }); setDirty(true); }}
                  onPaste={(e) => {
                    const files = pickImageFiles(e.clipboardData?.files ?? null);
                    if (files.length === 0) return;
                    e.preventDefault();
                    files.forEach((f) => { void uploadAndInsertImage(f, e.currentTarget); });
                  }}
                  onDrop={(e) => {
                    const files = pickImageFiles(e.dataTransfer?.files ?? null);
                    if (files.length === 0) return;
                    e.preventDefault();
                    files.forEach((f) => { void uploadAndInsertImage(f, e.currentTarget); });
                  }}
                  onDragOver={(e) => {
                    // 只有拖拽文件时才拦截默认行为，避免影响文本拖选
                    if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) e.preventDefault();
                  }}
                  placeholder={imageUploading ? '图片上传中…' : '支持 Markdown；可直接粘贴或拖拽图片到此处上传'}
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

      <AiArticleGenerator
        open={showAiGenerator}
        onClose={() => setShowAiGenerator(false)}
        onCreated={handleAiCreated}
      />
    </div>
  );
}