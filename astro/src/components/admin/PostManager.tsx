import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import { useAdminPosts } from '../../hooks/domains/useAdminPosts';
import { useAiAssist } from '../../hooks/domains/useAiAssist';
import { cn } from '../../lib/utils';
import { showToast } from '../ui/Toast';
import ConfirmDialog from '../ui/ConfirmDialog';
import MediaLibrary from './MediaLibrary';
import AiArticleGenerator from './AiArticleGenerator';
import { mediaService } from '../../lib/services/mediaService';
import { adminPostService, type Post } from '../../lib/services/adminPostService';
import type { AssistMetaResult } from '../../lib/services/aiAssistService';

/*
 * 文章管理（后台）
 * - 只用 --sf-* 令牌：surface/canvas + 四档细线 + 三档墨色 + 单一强调色，圆角统一 3px（徽标 2px）；
 * - 列表：等宽表头小字 + 1px 细线，行 hover 只改底色；
 * - 状态徽标细线 chip：已发布 emerald、草稿 amber、已归档中性 ink-3；
 * - 弹窗为实底表面 + 细线，输入与 ui/Input 一致（控制线 + 强调色 focus 环）；
 * - 筛选/搜索/分页/编辑/保存/删除/AI 辅助与媒体库选择逻辑与改造前完全一致。
 */

type PostDraft = Omit<Post, 'id' | 'created' | 'updated' | 'author' | 'published_at' | 'views'> & { id?: string };
type PostFilter = 'all' | 'published' | 'draft' | 'archived';

/* 状态徽标细线 chip：已发布 emerald、草稿 amber、已归档中性 ink-3。 */
const statusColors: Record<string, string> = {
  published: 'border-emerald-600/45 text-emerald-700 dark:border-emerald-400/45 dark:text-emerald-300',
  draft: 'border-amber-600/45 text-amber-700 dark:border-amber-400/45 dark:text-amber-300',
  archived: 'border-[var(--sf-line)] text-[var(--sf-ink-3)]',
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

const CHIP_BASE =
  'inline-flex items-center gap-1 rounded-[2px] border px-1.5 py-0.5 font-mono text-[10px] leading-none tracking-[0.08em]';

const BTN_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-[3px] border font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)] disabled:cursor-not-allowed disabled:opacity-50';
const BTN_PRIMARY =
  'border-[var(--sf-accent)] bg-[var(--sf-accent)] text-[var(--sf-on-accent)] hover:border-[var(--sf-accent-ink)] hover:bg-[var(--sf-accent-ink)]';
const BTN_QUIET =
  'border-[var(--sf-line)] bg-[var(--sf-surface)] text-[var(--sf-ink-2)] hover:border-[var(--sf-line-strong)] hover:text-[var(--sf-ink)]';
const BTN_SM = 'min-h-10 px-3 text-[12px]';

const FILTER_ON = 'border-[var(--sf-accent)] bg-[var(--sf-accent)] text-[var(--sf-on-accent)]';
const FILTER_OFF =
  'border-[var(--sf-line)] bg-[var(--sf-surface)] text-[var(--sf-ink-2)] hover:border-[var(--sf-line-strong)] hover:text-[var(--sf-ink)]';

const FIELD_CLS =
  'min-h-[40px] w-full min-w-0 rounded-[3px] border border-[var(--sf-line-control)] bg-[var(--sf-surface)] px-3 py-2.5 text-sm text-[var(--sf-ink)] placeholder:text-[var(--sf-ink-3)] outline-none transition-colors focus-visible:border-[var(--sf-accent)] focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)] disabled:cursor-not-allowed disabled:opacity-50';

const LABEL_CLS = 'mb-1.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--sf-ink-3)]';

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

// ---------- 弹窗焦点 / 滚动锁 ----------

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hasAttribute('hidden') &&
      !element.classList.contains('hidden') &&
      element.getAttribute('aria-hidden') !== 'true',
  );
}

/** Tab / Shift+Tab 在弹窗内首尾循环；焦点逃逸时拉回弹窗内。 */
function trapTabKey(container: HTMLElement, event: KeyboardEvent) {
  const focusables = getFocusableElements(container);
  if (focusables.length === 0) {
    event.preventDefault();
    container.focus();
    return;
  }
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement as HTMLElement | null;

  if (!active || !container.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return;
  }

  if (event.shiftKey) {
    if (active === first) {
      event.preventDefault();
      last.focus();
    }
  } else if (active === last) {
    event.preventDefault();
    first.focus();
  }
}

/** 元素是否仍参与可见布局（display:none / visibility:hidden / 完全透明 / hidden 属性都算不可见）。 */
function isElementVisible(element: HTMLElement): boolean {
  if (element.hasAttribute('hidden')) return false;
  const view = element.ownerDocument.defaultView;
  const style = view ? view.getComputedStyle(element) : null;
  if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) {
    return false;
  }
  return true;
}

/** 有效层级：行内 z-index 优先，其次计算样式；无法解析按 0 处理。 */
function effectiveZIndex(element: HTMLElement | null): number {
  if (!element) return 0;
  const inline = Number.parseInt(element.style.zIndex, 10);
  if (Number.isFinite(inline)) return inline;
  const view = element.ownerDocument.defaultView;
  const computed = view ? Number.parseInt(view.getComputedStyle(element).zIndex, 10) : Number.NaN;
  return Number.isFinite(computed) ? computed : 0;
}

/**
 * 元素所在的层叠高度：取自身与祖先里最大的 z-index。
 * dialog 的层级往往挂在外层遮罩上（例如 step-up 的 `z-[80]` 在 role=dialog 的父层），
 * 只看 dialog 自身会得到 0，误判成「比编辑器低」。
 */
function stackingZIndex(element: HTMLElement | null): number {
  let max = 0;
  let node: HTMLElement | null = element;
  while (node) {
    const z = effectiveZIndex(node);
    if (z > max) max = z;
    node = node.parentElement;
  }
  return max;
}

type ModalKeyboardOwner = 'self' | 'confirm' | 'other';

/**
 * 判断键盘事件该由谁处理，只有 PostManager 的弹窗在最顶层时才抢 Esc/Tab：
 * - 'confirm'：自己的 ConfirmDialog 打开中，由它处理（关闭、Tab 循环）；
 * - 'other'：另一层 aria-modal dialog 位于编辑器之上（如 StepUpRecoveryModal），
 *   必须让行——不 preventDefault、不抢焦点、不关闭编辑器；
 * - 'self'：编辑弹窗/媒体库是当前最顶层，由 PostManager 处理。
 *
 * 不能只看 `[role="alertdialog"]` 是否在 DOM 里：ConfirmDialog 关闭后
 * AnimatePresence 的退出动画仍会保留节点，那段时间必须重新由 PostManager 接管，
 * 否则退出动画期间按下的 Esc 会被「吞掉」。外部弹窗则按焦点归属 + 层级判断。
 */
function resolveModalKeyboardOwner(params: {
  ownPanels: HTMLElement[];
  topPanel: HTMLElement | null;
  confirmOpen: boolean;
}): ModalKeyboardOwner {
  if (params.confirmOpen) return 'confirm';
  const { ownPanels } = params;
  if (ownPanels.length === 0) return 'self';
  const topPanel = params.topPanel ?? ownPanels[ownPanels.length - 1];
  const topOverlay = topPanel.parentElement ?? topPanel;
  const ownZ = stackingZIndex(topPanel);
  const active = document.activeElement as HTMLElement | null;

  const externalDialogs = Array.from(
    document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'),
  ).filter(
    (element) =>
      !ownPanels.some(
        (panel) => element === panel || element.contains(panel) || panel.contains(element),
      ) && isElementVisible(element),
  );

  for (const element of externalDialogs) {
    // 焦点已经进入外部 dialog：用户正在操作那一层，无条件让行
    if (active && element.contains(active)) return 'other';
    const externalZ = stackingZIndex(element);
    if (externalZ > ownZ) return 'other';
    // 层级相同或都无法解析时按文档顺序：后挂载的弹窗视为上层
    if (
      externalZ === ownZ &&
      (topOverlay.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    ) {
      return 'other';
    }
  }

  return 'self';
}

// 背景滚动锁：编辑弹窗与媒体库弹窗可能叠加，按引用计数恢复原 overflow
let bodyScrollLocks = 0;let bodyOverflowBeforeLock = '';

function lockBodyScroll(): () => void {
  if (typeof document === 'undefined') return () => {};
  if (bodyScrollLocks === 0) {
    bodyOverflowBeforeLock = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  bodyScrollLocks += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    bodyScrollLocks = Math.max(0, bodyScrollLocks - 1);
    if (bodyScrollLocks === 0) document.body.style.overflow = bodyOverflowBeforeLock;
  };
}

/** 打开时把焦点送进弹窗并锁滚动，关闭时归还焦点并恢复滚动。 */
function useModalBehavior(open: boolean, getContainer: () => HTMLElement | null) {
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const unlock = lockBodyScroll();

    const container = getContainer();
    if (container) {
      const target =
        container.querySelector<HTMLElement>('[data-dialog-autofocus]') ??
        getFocusableElements(container)[0] ??
        container;
      target.focus();
    }

    return () => {
      unlock();
      const previous = previouslyFocusedRef.current;
      previouslyFocusedRef.current = null;
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [open, getContainer]);
}

// 判断草稿是否已有「实质内容」：决定关闭时要不要弹确认
const SUBSTANTIVE_FIELDS = [
  'title',
  'slug',
  'excerpt',
  'content',
  'cover',
  'seo_title',
  'seo_description',
  'seo_keywords',
] as const;

function draftHasSubstance(draft: Post | PostDraft): boolean {
  const record = draft as unknown as Record<string, unknown>;
  if (SUBSTANTIVE_FIELDS.some((field) => String(record[field] ?? '').trim() !== '')) return true;
  if (draft.status && draft.status !== 'draft') return true;
  if (draft.is_pinned || draft.is_featured) return true;
  return false;
}

type ConfirmState = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
};

export default function PostManager() {
  const {
    posts,
    loading,
    error,
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
    deletePost,
    savePost,
  } = useAdminPosts();

  const [confirmState, setConfirmState] = useState<ConfirmState>({ open: false, title: '', message: '', onConfirm: () => {} });
  const [showMediaLibrary, setShowMediaLibrary] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [showAiGenerator, setShowAiGenerator] = useState(false);
  const [metaResult, setMetaResult] = useState<AssistMetaResult | null>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const editorPanelRef = useRef<HTMLDivElement>(null);
  const mediaPanelRef = useRef<HTMLDivElement>(null);
  const getEditorPanel = useCallback(() => editorPanelRef.current, []);
  const getMediaPanel = useCallback(() => mediaPanelRef.current, []);
  // 供键盘监听/确认回调读取的「最新保存中」状态（state 在闭包里可能过期）
  const savingRef = useRef(saving);
  // ConfirmDialog 是否真的处于打开状态：用它而不是查 DOM，退出动画期间不吞键盘
  const confirmOpenRef = useRef(confirmState.open);
  const { assisting, runMeta, runPolish, runContinue } = useAiAssist();

  useEffect(() => {
    savingRef.current = saving;
  }, [saving]);

  useEffect(() => {
    confirmOpenRef.current = confirmState.open;
  }, [confirmState.open]);

  const closeEditor = useCallback(() => {
    setEditing(null);
    setDirty(false);
  }, [setEditing, setDirty]);

  const closeMediaLibrary = useCallback(() => setShowMediaLibrary(false), []);

  // 统一关闭入口：有未保存的实质内容时先确认，空草稿/无改动直接关。
  // 取消、遮罩点击、Esc 全部走这里，保证三处行为一致。
  const requestCloseEditing = useCallback(() => {
    if (!editing) return;
    // 保存进行中禁止关闭：保存完成时会回写结果，提前关闭（或再开新文）会被误关
    if (saving) {
      showToast('文章保存中，完成后才能关闭', 'warning');
      return;
    }
    const needsConfirm = editing.id
      ? dirty
      : (dirty && draftHasSubstance(editing)) || selectedTagIds.length > 0;
    if (!needsConfirm) {
      closeEditor();
      return;
    }
    setConfirmState({
      open: true,
      title: '放弃未保存的修改？',
      message: '当前编辑有未保存的内容，关闭后这些修改会丢失。',
      confirmLabel: '放弃修改',
      danger: true,
      // 确认框打开期间保存也可能开始：真正关闭前再查一次保存锁
      onConfirm: () => {
        if (savingRef.current) {
          showToast('文章保存中，完成后才能关闭', 'warning');
          return;
        }
        closeEditor();
      },
    });
  }, [editing, saving, dirty, selectedTagIds, closeEditor]);

  // 编辑弹窗与媒体库弹窗各自把焦点送进去、锁滚动；关闭时按层归还焦点/恢复滚动
  useModalBehavior(editing !== null, getEditorPanel);
  useModalBehavior(showMediaLibrary, getMediaPanel);

  // 弹窗打开期间的 Esc / Tab 统一在 document 上处理（焦点在弹窗外也生效）。
  // 只有 PostManager 的弹窗是顶层 dialog 时才抢键盘：顶层是 ConfirmDialog 或外部
  // step-up 重验弹窗时一律让行，避免一次 Esc 同时关掉两层/覆盖上层 dialog 的语义。
  const anyModalOpen = editing !== null || showMediaLibrary;
  useEffect(() => {
    if (!anyModalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const owner = resolveModalKeyboardOwner({
        ownPanels: [editorPanelRef.current, mediaPanelRef.current].filter(
          (panel): panel is HTMLDivElement => panel !== null,
        ),
        topPanel: showMediaLibrary ? mediaPanelRef.current : editorPanelRef.current,
        confirmOpen: confirmOpenRef.current,
      });
      if (owner !== 'self') return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (showMediaLibrary) closeMediaLibrary();
        else requestCloseEditing();
        return;
      }
      if (event.key !== 'Tab') return;
      const container = showMediaLibrary ? mediaPanelRef.current : editorPanelRef.current;
      if (container) trapTabKey(container, event);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [anyModalOpen, showMediaLibrary, closeMediaLibrary, requestCloseEditing]);

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
      confirmLabel: '删除',
      danger: true,
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
    // 提交中防重入：按钮禁用 + hook 内部同步锁双保险
    if (saving) return;
    void savePost();
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
    <div className="min-w-0 space-y-3">
      {/* 工具栏 */}
      <div className="rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {(['all', 'published', 'draft', 'archived'] as PostFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className={cn(
                  'min-h-10 rounded-[3px] border px-2.5 font-mono text-[11px] tracking-[0.06em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)]',
                  filter === f ? FILTER_ON : FILTER_OFF
                )}
              >
                {filterLabels[f]}
              </button>
            ))}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="搜索文章..."
              aria-label="搜索文章"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={cn(FIELD_CLS, 'w-full py-2 sm:w-auto sm:min-w-[200px]')}
            />
            <button onClick={handleNew} className={cn(BTN_BASE, BTN_PRIMARY, BTN_SM)}>
              + 新建文章
            </button>
            <button
              onClick={() => setShowAiGenerator(true)}
              className={cn(BTN_BASE, BTN_QUIET, BTN_SM)}
              title="用 AI 依据主题与大纲生成草稿"
            >
              ✨ AI 生成
            </button>
          </div>
        </div>
      </div>

      {/* 列表错误：显式展示 + 可重试，绝不把请求失败伪装成「暂无文章」 */}
      {error && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-[3px] border border-[var(--sf-danger)] bg-[var(--sf-surface)] px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="break-words text-[13px] leading-relaxed text-[var(--sf-danger)] [overflow-wrap:anywhere]">
            文章列表加载失败：{error}
          </p>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {/* 翻页失败的安全出口：旧页数据已清空时，一键回到第 1 页重新取数 */}
              {page > 1 && (
                <button
                  type="button"
                  onClick={() => setPage(1)}
                  disabled={loading}
                  className={cn(BTN_BASE, BTN_QUIET, BTN_SM)}
                >
                  返回第 1 页
                </button>
              )}
              <button
                type="button"
                onClick={() => { void fetchPosts(); }}
                disabled={loading}
                className={cn(BTN_BASE, BTN_QUIET, BTN_SM)}
              >
                重试
              </button>
            </div>
          </div>
      )}

      {/* 文章列表 */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-[3px] border border-[var(--sf-line-soft)] bg-[var(--sf-canvas)]" />
          ))}
        </div>
      ) : filteredPosts.length === 0 ? (
        error ? null : (
          <div className="flex flex-col items-center gap-1.5 rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] px-3 py-10 text-center">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--sf-ink-3)]">EMPTY / 0</p>
            <p className="text-[13px] text-[var(--sf-ink-2)]">暂无文章</p>
          </div>
        )
      ) : (
        <div className="min-w-0 overflow-hidden rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)]">
          <div className="flex items-center justify-between gap-2 border-b border-[var(--sf-line)] bg-[var(--sf-canvas)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--sf-ink-3)]">
            <span>Post / 文章</span>
            <span className="tabular-nums">共 {filteredPosts.length} 条</span>
          </div>
          <motion.div
            variants={listVariants}
            initial="hidden"
            animate="visible"
          >
            {filteredPosts.map((post) => (
              <motion.div
                key={post.id}
                variants={itemVariants}
                className="min-w-0 border-b border-[var(--sf-line-soft)] px-3 py-3 transition-colors last:border-b-0 hover:bg-[var(--sf-canvas)]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={CHIP_BASE + ' ' + (statusColors[post.status] || 'border-[var(--sf-line)] text-[var(--sf-ink-3)]')}>
                        {statusLabels[post.status]}
                      </span>
                      {post.is_pinned && (
                        <span className={CHIP_BASE + ' border-[var(--sf-accent)] text-[var(--sf-accent-ink)]'}>
                          置顶
                        </span>
                      )}
                      {post.is_featured && (
                        <span className={CHIP_BASE + ' border-amber-600/45 text-amber-700 dark:border-amber-400/45 dark:text-amber-300'}>
                          精选
                        </span>
                      )}
                      {post.is_ai && (
                        <span
                          className={CHIP_BASE + ' border-[var(--sf-accent)] text-[var(--sf-accent-ink)]'}
                          title="本文由 AI 一键成文创建"
                        >
                          AI 生成
                        </span>
                      )}
                    </div>
                    <h3 className="mt-1.5 break-words text-[13px] font-semibold leading-snug text-[var(--sf-ink)] [overflow-wrap:anywhere]">{post.title}</h3>
                    <p className="mt-1 line-clamp-2 break-words text-[13px] leading-relaxed text-[var(--sf-ink-2)] [overflow-wrap:anywhere]">{post.excerpt}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] tracking-[0.06em] text-[var(--sf-ink-3)]">
                      <span className="tabular-nums">{formatDate(post.published_at || post.updated)}</span>
                      <span className="tabular-nums">{post.views || 0} 浏览</span>
                      <span className="break-all">/{post.slug}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => handleAiOptimize(post)}
                      disabled={assisting !== null}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] text-[var(--sf-ink-2)] transition-colors hover:border-[var(--sf-accent)] hover:text-[var(--sf-accent-ink)] disabled:cursor-not-allowed disabled:opacity-50"
                      title="AI 优化（生成标题/摘要/标签建议）"
                      aria-label="AI 优化"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleEdit(post)}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] text-[var(--sf-ink-2)] transition-colors hover:border-[var(--sf-line-control)] hover:text-[var(--sf-ink)]"
                      title="编辑"
                      aria-label="编辑"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(post.id)}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] text-[var(--sf-ink-2)] transition-colors hover:border-[var(--sf-danger)] hover:text-[var(--sf-danger)]"
                      title="删除"
                      aria-label="删除"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      )}

      {/* 分页 */}
      {totalPages > 1 && (
        <nav className="flex flex-wrap items-center gap-2" aria-label="文章分页">
          <span className="mr-auto font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--sf-ink-3)]">
            PAGE / {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage(page - 1)}
            disabled={page <= 1}
            className={cn(BTN_BASE, BTN_QUIET, BTN_SM)}
          >
            上一页
          </button>
          <button
            onClick={() => setPage(page + 1)}
            disabled={page >= totalPages}
            className={cn(BTN_BASE, BTN_QUIET, BTN_SM)}
          >
            下一页
          </button>
        </nav>
      )}

      {/* 编辑弹窗 */}
      <AnimatePresence>
        {editing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-stretch justify-center overflow-y-auto bg-[var(--sf-scrim)] p-0 sm:items-center sm:p-4"
            onClick={requestCloseEditing}
          >
            <motion.div
              ref={editorPanelRef}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="post-manager-title"
              tabIndex={-1}
              className="flex min-h-[var(--vvh,100dvh)] w-full max-w-4xl flex-col overflow-hidden rounded-none border border-[var(--sf-line)] bg-[var(--sf-surface)] p-4 sm:min-h-0 sm:rounded-[3px] sm:p-6"
            >
              <h2 id="post-manager-title" className="mb-4 break-words border-b border-[var(--sf-line)] pb-3 text-base font-bold tracking-tight text-[var(--sf-ink)] [overflow-wrap:anywhere]">
                {editing.id ? '编辑文章' : '新建文章'}
              </h2>

              {/* AI 工具条：三个动作共用 assisting 状态防重入 */}
              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                <span className="mr-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--sf-ink-3)]">AI</span>
                <button
                  onClick={handleAiMeta}
                  disabled={assisting !== null}
                  className={cn(BTN_BASE, BTN_QUIET, 'min-h-8 px-2.5 text-[12px]')}
                >
                  {assisting === 'meta' ? '生成中…' : 'AI 标题/摘要/标签'}
                </button>
                <button
                  onClick={handleAiPolish}
                  disabled={assisting !== null}
                  className={cn(BTN_BASE, BTN_QUIET, 'min-h-8 px-2.5 text-[12px]')}
                >
                  {assisting === 'polish' ? '生成中…' : 'AI 润色'}
                </button>
                <button
                  onClick={handleAiContinue}
                  disabled={assisting !== null}
                  className={cn(BTN_BASE, BTN_QUIET, 'min-h-8 px-2.5 text-[12px]')}
                >
                  {assisting === 'continue' ? '生成中…' : 'AI 续写'}
                </button>
              </div>

              {metaResult && (
                <div className="mb-4 space-y-3 rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-canvas)] p-3 sm:p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--sf-accent-ink)]">AI 建议</span>
                    <button
                      onClick={() => setMetaResult(null)}
                      className="min-h-8 rounded-[3px] border border-[var(--sf-line)] px-2 font-mono text-[11px] text-[var(--sf-ink-2)] transition-colors hover:border-[var(--sf-line-control)] hover:text-[var(--sf-ink)]"
                    >
                      收起
                    </button>
                  </div>

                  {metaResult.titles.length > 0 && (
                    <div>
                      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--sf-ink-3)]">候选标题（点击回填）</div>
                      <div className="flex flex-wrap gap-1.5">
                        {metaResult.titles.map((title, i) => (
                          <button
                            key={`${i}-${title}`}
                            onClick={() => handleApplyTitle(title)}
                            className="max-w-full break-words rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] px-2.5 py-1.5 text-left text-[12px] text-[var(--sf-ink-2)] transition-colors hover:border-[var(--sf-accent)] hover:text-[var(--sf-accent-ink)] [overflow-wrap:anywhere]"
                          >
                            {title}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {metaResult.excerpt && (
                    <div>
                      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--sf-ink-3)]">摘要</div>
                      <p className="break-words text-[12px] leading-relaxed text-[var(--sf-ink)] [overflow-wrap:anywhere]">{metaResult.excerpt}</p>
                      <button
                        onClick={handleApplyExcerpt}
                        className={cn(BTN_BASE, BTN_QUIET, 'mt-2 min-h-8 px-2.5 text-[12px]')}
                      >
                        回填摘要
                      </button>
                    </div>
                  )}

                  {metaResult.tag_names.length > 0 && (
                    <div>
                      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--sf-ink-3)]">建议标签</div>
                      <div className="flex flex-wrap gap-1.5">
                        {metaResult.tag_names.map((name, i) => (
                          <span
                            key={`${i}-${name}`}
                            className={CHIP_BASE + ' border-[var(--sf-line)] text-[var(--sf-ink-3)]'}
                          >
                            {name}
                          </span>
                        ))}
                      </div>
                      <button
                        onClick={handleApplyTags}
                        className={cn(BTN_BASE, BTN_QUIET, 'mt-2 min-h-8 px-2.5 text-[12px]')}
                      >
                        并入已选标签
                      </button>
                    </div>
                  )}

                  {metaResult.seo_description && (
                    <div>
                      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--sf-ink-3)]">SEO 描述</div>
                      <p className="break-words text-[12px] leading-relaxed text-[var(--sf-ink)] [overflow-wrap:anywhere]">{metaResult.seo_description}</p>
                      <button
                        onClick={handleApplySeoDescription}
                        className={cn(BTN_BASE, BTN_QUIET, 'mt-2 min-h-8 px-2.5 text-[12px]')}
                      >
                        回填 SEO 描述
                      </button>
                    </div>
                  )}
                </div>
              )}
              
              <div className="grid gap-3 md:grid-cols-2 md:gap-4">
                <div className="space-y-3">
                  <div>
                    <label htmlFor="post-manager-title-field" className={LABEL_CLS}>标题</label>
                    <input
                      id="post-manager-title-field"
                      type="text"
                      data-dialog-autofocus
                      value={editing.title}
                      onChange={(e) => { setEditing({ ...editing, title: e.target.value }); setDirty(true); }}
                      className={FIELD_CLS}
                    />
                  </div>
                  <div>
                    <label htmlFor="post-manager-slug" className={LABEL_CLS}>Slug</label>
                    <input
                      id="post-manager-slug"
                      type="text"
                      value={editing.slug}
                      onChange={(e) => { setEditing({ ...editing, slug: e.target.value }); setDirty(true); }}
                      className={cn(FIELD_CLS, 'font-mono')}
                    />
                  </div>
                  <div>
                    <label htmlFor="post-manager-excerpt" className={LABEL_CLS}>摘要</label>
                    <textarea
                      id="post-manager-excerpt"
                      value={editing.excerpt || ''}
                      onChange={(e) => { setEditing({ ...editing, excerpt: e.target.value }); setDirty(true); }}
                      rows={3}
                      className={cn(FIELD_CLS, 'min-h-[80px] resize-y')}
                    />
                  </div>
                  <div>
                    <label htmlFor="post-manager-cover" className={LABEL_CLS}>封面</label>
                    <div className="flex gap-2">
                      <input
                        id="post-manager-cover"
                        type="text"
                        value={editing.cover || ''}
                        onChange={(e) => { setEditing({ ...editing, cover: e.target.value }); setDirty(true); }}
                        className={FIELD_CLS}
                        placeholder="封面图片 URL"
                      />
                      <button
                        onClick={() => setShowMediaLibrary(true)}
                        className={cn(BTN_BASE, BTN_QUIET, 'min-h-[40px] shrink-0 px-3 text-[12px]')}
                      >
                        选择
                      </button>
                    </div>
                  </div>
                </div>
                
                <div className="space-y-3">
                  <div>
                    <label htmlFor="post-manager-status" className={LABEL_CLS}>状态</label>
                    <select
                      id="post-manager-status"
                      value={editing.status}
                      onChange={(e) => { setEditing({ ...editing, status: e.target.value as Post['status'] }); setDirty(true); }}
                      className={FIELD_CLS}
                    >
                      <option value="draft">草稿</option>
                      <option value="published">已发布</option>
                      <option value="archived">已归档</option>
                    </select>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={(editing as any).is_pinned || false}
                        onChange={(e) => { setEditing({ ...editing, is_pinned: e.target.checked } as any); setDirty(true); }}
                        className="h-4 w-4 rounded-[2px] border-[var(--sf-line-control)] accent-[var(--sf-accent)]"
                      />
                      <span className="text-[13px] text-[var(--sf-ink)]">置顶</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={(editing as any).is_featured || false}
                        onChange={(e) => { setEditing({ ...editing, is_featured: e.target.checked } as any); setDirty(true); }}
                        className="h-4 w-4 rounded-[2px] border-[var(--sf-line-control)] accent-[var(--sf-accent)]"
                      />
                      <span className="text-[13px] text-[var(--sf-ink)]">精选</span>
                    </label>
                  </div>
                  <div>
                    <span className={LABEL_CLS}>标签</span>
                    <div className="flex flex-wrap gap-1.5">
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
                          aria-pressed={selectedTagIds.includes(tag.id)}
                          className={cn(
                            'break-words rounded-[3px] border px-2 py-0.5 font-mono text-[11px] tracking-[0.04em] transition-colors [overflow-wrap:anywhere]',
                            selectedTagIds.includes(tag.id)
                              ? 'border-[var(--sf-accent)] bg-[var(--sf-accent)] text-[var(--sf-on-accent)]'
                              : 'border-[var(--sf-line)] bg-[var(--sf-surface)] text-[var(--sf-ink-2)] hover:border-[var(--sf-line-strong)] hover:text-[var(--sf-ink)]'
                          )}
                        >
                          {tag.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="mt-3">
                <label htmlFor="post-manager-content" className={LABEL_CLS}>内容</label>
                <textarea
                  id="post-manager-content"
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
                  className={cn(FIELD_CLS, 'min-h-[240px] resize-y font-mono text-[12px] leading-relaxed')}
                />
              </div>
              
              <div className="mt-4 flex flex-col-reverse gap-2 border-t border-[var(--sf-line)] pt-3 sm:flex-row sm:justify-end">
                <button type="button" onClick={requestCloseEditing} className={cn(BTN_BASE, BTN_QUIET, BTN_SM)}>
                  取消
                </button>
                <button type="button" onClick={handleSave} disabled={saving} className={cn(BTN_BASE, BTN_PRIMARY, BTN_SM)}>
                  {saving ? '保存中...' : '保存文章'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 媒体库选择器 */}
      {showMediaLibrary && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--sf-scrim)] p-3 sm:p-4"
          onClick={closeMediaLibrary}
        >
          <div
            ref={mediaPanelRef}
            role="dialog"
            aria-modal="true"
            aria-label="选择封面图片"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)]"
          >
            <div className="flex items-center justify-between gap-2 border-b border-[var(--sf-line)] px-3 py-2.5 sm:px-4">
              <h3 className="break-words text-sm font-bold tracking-tight text-[var(--sf-ink)]">选择封面图片</h3>
              <button
                type="button"
                data-dialog-autofocus
                onClick={closeMediaLibrary}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[3px] border border-[var(--sf-line)] text-[var(--sf-ink-2)] transition-colors hover:border-[var(--sf-line-control)] hover:text-[var(--sf-ink)]"
                title="关闭"
                aria-label="关闭"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="max-h-[calc(90vh-60px)] min-h-0 overflow-auto p-3 sm:p-4">
              <MediaLibrary onSelect={handleCoverSelect} onClose={closeMediaLibrary} />
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        message={confirmState.message}
        confirmLabel={confirmState.confirmLabel}
        danger={confirmState.danger}
        onConfirm={() => {
          const action = confirmState.onConfirm;
          setConfirmState(s => ({ ...s, open: false }));
          action();
        }}
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
