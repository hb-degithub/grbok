import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import { useAdminPosts } from '../../hooks/domains/useAdminPosts';
import { useAiAssist } from '../../hooks/domains/useAiAssist';
import { cn } from '../../lib/utils';
import { showToast } from '../ui/Toast';
import ConfirmDialog from '../ui/ConfirmDialog';
import MediaLibrary from './MediaLibrary';
import AiArticleGenerator from './AiArticleGenerator';
import MarkdownPreview from './MarkdownPreview';
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

// ---------- Markdown 写作台：工具条 / 快捷键插入 ----------

type EditorTab = 'edit' | 'preview';

type MarkdownAction =
  | 'bold'
  | 'italic'
  | 'inlineCode'
  | 'codeBlock'
  | 'link'
  | 'table'
  | 'quote'
  | 'orderedList'
  | 'unorderedList'
  | 'heading';

/** 正文里的一段字符区间（内容坐标） */
interface TextRange {
  start: number;
  end: number;
}

/** 一次 Markdown 插入：替换原文 [start,end)，写入 text，并在插入文本内恢复选区 */
interface MarkdownInsertion {
  start: number;
  end: number;
  text: string;
  /** 相对插入文本起点的选区（最终内容坐标 = start + selection.start） */
  selection: TextRange;
}

const EDITOR_TABS: EditorTab[] = ['edit', 'preview'];

/** Cmd/Ctrl + 字母 → 格式化动作；输入法组合期间不生效（见 onKeyDown 守卫） */
const MOD_SHORTCUTS: Record<string, MarkdownAction> = {
  b: 'bold',
  i: 'italic',
  k: 'link',
  e: 'inlineCode',
};

/** 代码块语言：默认 text（纯文本围栏），其余与前台高亮语言对齐 */
const CODE_LANGUAGES: Array<{ value: string; label: string }> = [
  { value: 'text', label: 'text' },
  { value: 'javascript', label: 'javascript' },
  { value: 'typescript', label: 'typescript' },
  { value: 'tsx', label: 'tsx' },
  { value: 'jsx', label: 'jsx' },
  { value: 'python', label: 'python' },
  { value: 'bash', label: 'bash' },
  { value: 'json', label: 'json' },
  { value: 'html', label: 'html' },
  { value: 'css', label: 'css' },
  { value: 'sql', label: 'sql' },
  { value: 'go', label: 'go' },
  { value: 'rust', label: 'rust' },
  { value: 'java', label: 'java' },
  { value: 'yaml', label: 'yaml' },
  { value: 'markdown', label: 'markdown' },
  { value: 'diff', label: 'diff' },
];

// 正文渲染只放行 h2–h4（见 lib/markdown.ts 的净化白名单），H1 会退化成普通段落
const HEADING_LEVELS = [2, 3, 4] as const;

const TABLE_SNIPPET = '| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |';

function clampIndex(value: number, max: number): number {
  if (!Number.isFinite(value)) return max;
  return Math.max(0, Math.min(value, max));
}

/** 行内包裹：有选区就包住选区，没有选区就插入占位文本并选中它（直接打字即可替换）。 */
function wrapInsertion(
  content: string,
  range: TextRange,
  before: string,
  after: string,
  placeholder: string,
): MarkdownInsertion {
  const selected = content.slice(range.start, range.end);
  const inner = selected || placeholder;
  return {
    start: range.start,
    end: range.end,
    text: before + inner + after,
    selection: { start: before.length, end: before.length + inner.length },
  };
}

/** 按行插入前缀（引用 / 列表 / 标题）：选区跨行时逐行处理。 */
function lineInsertion(
  content: string,
  range: TextRange,
  prefix: (lineIndex: number) => string,
): MarkdownInsertion {
  // 选区可能落在行中间：先扩到整行，避免把前缀插进句子中间
  const lineStart = content.lastIndexOf('\n', Math.max(0, range.start - 1)) + 1;
  const newlineIndex = content.indexOf('\n', range.end);
  const lineEnd = newlineIndex === -1 ? content.length : newlineIndex;
  const text = content
    .slice(lineStart, lineEnd)
    .split('\n')
    .map((line, index) => prefix(index) + line)
    .join('\n');
  return {
    start: lineStart,
    end: lineEnd,
    text,
    selection: { start: 0, end: text.length },
  };
}

/**
 * 块级插入（围栏代码块 / 表格）：前后按需补空行，
 * 保证围栏与表格不会被上一段文字吞掉、无法解析成独立块。
 */
function blockInsertion(
  content: string,
  range: TextRange,
  block: string,
  caret: number = block.length,
): MarkdownInsertion {
  const head = content.slice(0, range.start);
  const tail = content.slice(range.end);
  const leading =
    head.length > 0 && !head.endsWith('\n\n') ? (head.endsWith('\n') ? '\n' : '\n\n') : '';
  const trailing =
    tail.length > 0 && !tail.startsWith('\n\n') ? (tail.startsWith('\n') ? '\n' : '\n\n') : '';
  const offset = leading.length + caret;
  return {
    start: range.start,
    end: range.end,
    text: leading + block + trailing,
    selection: { start: offset, end: offset },
  };
}

function codeBlockInsertion(content: string, range: TextRange, language: string): MarkdownInsertion {
  const fence = '```' + language;
  const selected = content.slice(range.start, range.end);
  // 有选区：把选区整段变成代码；无选区：插入空围栏并把光标停在中间空行
  const block = selected ? fence + '\n' + selected + '\n```' : fence + '\n\n```';
  const caret = selected ? block.length : fence.length + 1;
  return blockInsertion(content, range, block, caret);
}

function linkInsertion(content: string, range: TextRange): MarkdownInsertion {
  const selected = content.slice(range.start, range.end);
  const label = selected || '链接文字';
  const url = 'https://';
  return {
    start: range.start,
    end: range.end,
    text: `[${label}](${url})`,
    // 选中协议占位符：直接粘贴或输入地址即可覆盖
    selection: { start: label.length + 3, end: label.length + 3 + url.length },
  };
}

/** 按动作生成插入片段；返回 null 表示该动作不写正文（例如图片走媒体库） */
function buildMarkdownInsertion(
  action: MarkdownAction,
  content: string,
  range: TextRange,
  options: { language: string; headingLevel: number },
): MarkdownInsertion | null {
  switch (action) {
    case 'bold':
      return wrapInsertion(content, range, '**', '**', '加粗文本');
    case 'italic':
      return wrapInsertion(content, range, '*', '*', '斜体文本');
    case 'inlineCode':
      return wrapInsertion(content, range, '`', '`', '代码');
    case 'codeBlock':
      return codeBlockInsertion(content, range, options.language || 'text');
    case 'link':
      return linkInsertion(content, range);
    case 'table':
      return blockInsertion(content, range, TABLE_SNIPPET);
    case 'quote':
      return lineInsertion(content, range, () => '> ');
    case 'unorderedList':
      return lineInsertion(content, range, () => '- ');
    case 'orderedList':
      return lineInsertion(content, range, (index) => `${index + 1}. `);
    case 'heading': {
      const level = Math.max(1, Math.min(6, options.headingLevel));
      return lineInsertion(content, range, () => '#'.repeat(level) + ' ');
    }
    default:
      return null;
  }
}

/** 媒体库只回传 URL：alt 用文件名兜底，与拖拽上传的 alt 回退保持一致 */
function imageAltFromUrl(url: string): string {
  try {
    const path = url.split('?')[0].split('#')[0];
    const name = decodeURIComponent(path.split('/').pop() || '');
    return name.replace(/\.[a-z0-9]+$/i, '') || '图片';
  } catch {
    return '图片';
  }
}

const FORMAT_BTN_CLS =
  'inline-flex h-8 min-w-8 items-center justify-center rounded-[2px] border border-[var(--sf-line)] bg-[var(--sf-surface)] px-2 font-mono text-[11px] leading-none text-[var(--sf-ink-2)] transition-colors hover:border-[var(--sf-line-control)] hover:text-[var(--sf-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)] disabled:cursor-not-allowed disabled:opacity-50';

interface FormatButtonProps {
  action: MarkdownAction;
  /** 无障碍名称（工具条按钮全部用 aria-label 暴露动作名） */
  label: string;
  /** 快捷键提示，写进 title */
  shortcut?: string;
  visible?: React.ReactNode;
  onAction: (action: MarkdownAction) => void;
}

/** 工具条按钮：mousedown 不抢焦点，保证 textarea 的选区在点击时仍然有效 */
function FormatButton({ action, label, shortcut, visible, onAction }: FormatButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={shortcut ? `${label}（${shortcut}）` : label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onAction(action)}
      className={FORMAT_BTN_CLS}
    >
      {visible ?? label}
    </button>
  );
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
      // 隐藏的 tabpanel（编辑 / 预览）里的控件不参与 Tab 循环
      !element.closest('[hidden]') &&
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
  const [imageUploading, setImageUploading] = useState(false);
  const [showAiGenerator, setShowAiGenerator] = useState(false);
  const [metaResult, setMetaResult] = useState<AssistMetaResult | null>(null);
  // 媒体库选择器有两种用途：回填封面 / 在光标处插入正文插图
  const [mediaTarget, setMediaTarget] = useState<'cover' | 'content' | null>(null);
  const showMediaLibrary = mediaTarget !== null;
  // 正文「编辑 / 预览」tab：默认编辑，打开弹窗时重置
  const [editorTab, setEditorTab] = useState<EditorTab>('edit');
  const [codeLanguage, setCodeLanguage] = useState('text');
  const [headingLevel, setHeadingLevel] = useState<number>(2);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const editorPanelRef = useRef<HTMLDivElement>(null);
  const mediaPanelRef = useRef<HTMLDivElement>(null);
  const editTabRef = useRef<HTMLButtonElement>(null);
  const previewTabRef = useRef<HTMLButtonElement>(null);
  // 工具条/快捷键插入与 AI 回写后要恢复的选区（内容坐标，重渲染后应用）
  const pendingSelectionRef = useRef<TextRange | null>(null);
  // 打开媒体库前记录的正文插入位置：弹窗会抢焦点，取不到 textarea 选区
  const pendingInsertRangeRef = useRef<TextRange | null>(null);
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

  const closeMediaLibrary = useCallback(() => setMediaTarget(null), []);

  // 工具条 / 快捷键 / AI 回写后恢复光标或选区：
  // 受控 textarea 的值来自 state，只能在内容重渲染之后设置选区。
  useEffect(() => {
    const range = pendingSelectionRef.current;
    if (!range) return;
    const el = contentRef.current;
    if (!el || editorTab !== 'edit') return;
    pendingSelectionRef.current = null;
    const max = el.value.length;
    const start = Math.max(0, Math.min(range.start, max));
    const end = Math.max(start, Math.min(range.end, max));
    el.setSelectionRange(start, end);
  });

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
      // alt 回退文件名（媒体库上传时 alt 存的就是文件名，历史数据可能为空/空白）
      const alt = ((asset.alt || '').trim() || file.name || '图片').replace(/[[\]]/g, '');
      const snippet = `\n![${alt}](${url})\n`;
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

  /**
   * 打开媒体库：
   * - cover：选择封面（回填 cover 字段）；
   * - content：选择插图（在正文当前光标处插入 Markdown 图片语法）。
   * 打开前先记下 textarea 选区：媒体库弹窗会把焦点移走，之后取不到原位置。
   */
  const openMediaPicker = (target: 'cover' | 'content') => {
    if (target === 'content') {
      const el = contentRef.current;
      const length = (editing?.content || '').length;
      pendingInsertRangeRef.current = {
        start: clampIndex(el?.selectionStart ?? length, length),
        end: clampIndex(el?.selectionEnd ?? length, length),
      };
    }
    setMediaTarget(target);
  };

  const handleMediaSelect = (url: string) => {
    const target = mediaTarget;
    setMediaTarget(null);
    if (!editing || !target) return;
    if (target === 'cover') {
      setEditing((prev) => (prev ? { ...prev, cover: url } : prev));
      setDirty(true);
      return;
    }
    const anchor = pendingInsertRangeRef.current;
    pendingInsertRangeRef.current = null;
    const length = (editing.content || '').length;
    const start = clampIndex(anchor?.start ?? length, length);
    const end = clampIndex(anchor?.end ?? start, length);
    // 与拖拽上传同一条渲染管线：GitHub 风格 ![alt](url)
    applyContentText(start, end, `![${imageAltFromUrl(url)}](${url})`);
  };

  // ---------- AI 辅助写作 ----------

  const editingOpen = editing !== null;
  useEffect(() => {
    if (!editingOpen) setMetaResult(null);
    // 每次打开/切换编辑对象都回到编辑 tab，避免上次停在预览态
    if (editingOpen) setEditorTab('edit');
  }, [editingOpen]);

  /** 回填单个字段并标记未保存（弹窗关闭时会清空 AI 建议） */
  const patchEditing = (patch: Partial<Post>) => {
    setEditing((prev) => (prev ? ({ ...prev, ...patch } as Post) : prev));
    setDirty(true);
  };

  /**
   * 工具条 / 快捷键写正文：替换 [start, end) 并恢复光标（受控值只来自 editing.content）。
   * 先走 textarea.setRangeText 的原生编辑管线，让浏览器撤销栈保留这一步；
   * 随后 React 拿到同样的内容就不会再写 DOM，光标由上面的 selection effect 恢复。
   */
  const applyContentText = (start: number, end: number, text: string, selection?: TextRange) => {
    const el = contentRef.current;
    const base = el?.value ?? editing?.content ?? '';
    const from = clampIndex(start, base.length);
    const to = clampIndex(end, base.length);
    const next = base.slice(0, from) + text + base.slice(to);
    if (el && el.value === base) el.setRangeText(text, from, to, 'end');
    pendingSelectionRef.current = {
      start: from + (selection?.start ?? text.length),
      end: from + (selection?.end ?? text.length),
    };
    setEditing((prev) => (prev ? { ...prev, content: next } : prev));
    setDirty(true);
  };

  /**
   * 工具条 / 快捷键共用的入口：读当前选区 → 生成片段 → 写回正文并保持选区。
   * textarea 在预览 tab 里隐藏，此时工具条本身不可见，不需要额外限制。
   */
  const applyMarkdownAction = (action: MarkdownAction) => {
    const el = contentRef.current;
    if (!el) return;
    const content = el.value;
    const start = clampIndex(el.selectionStart ?? content.length, content.length);
    const end = clampIndex(el.selectionEnd ?? start, content.length);
    const insertion = buildMarkdownInsertion(action, content, { start, end }, {
      language: codeLanguage,
      headingLevel,
    });
    if (!insertion) return;
    applyContentText(insertion.start, insertion.end, insertion.text, insertion.selection);
    el.focus();
  };

  /** 正文快捷键：Cmd/Ctrl+B/I/K/E 与 Shift+Enter（输入法组合期间全部让行） */
  const handleContentKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const mod = event.metaKey || event.ctrlKey;
    if (mod && !event.altKey) {
      const action = MOD_SHORTCUTS[event.key.toLowerCase()];
      if (action) {
        event.preventDefault();
        applyMarkdownAction(action);
      }
      return;
    }
    if (event.shiftKey && !event.altKey && event.key === 'Enter') {
      event.preventDefault();
      applyMarkdownAction('codeBlock');
    }
  };

  /** tablist 方向键 / Home / End：切换 tab 并把焦点送到新 tab（roving tabindex） */
  const handleEditorTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const current = EDITOR_TABS.indexOf(editorTab);
    let next: number;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % EDITOR_TABS.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + EDITOR_TABS.length) % EDITOR_TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = EDITOR_TABS.length - 1;
    else return;
    event.preventDefault();
    const target = EDITOR_TABS[next];
    setEditorTab(target);
    (target === 'edit' ? editTabRef : previewTabRef).current?.focus();
  };

  /** 在正文 [start, end) 区间写入 text；函数式更新避免覆盖异步等待期间的新输入 */
  const replaceContentRange = (start: number, end: number, text: string, selection?: TextRange) => {
    const length = (contentRef.current?.value ?? editing?.content ?? '').length;
    setEditing((prev) => {
      if (!prev) return prev;
      const content = prev.content || '';
      const from = Math.max(0, Math.min(start, content.length));
      const to = Math.max(from, Math.min(end, content.length));
      return { ...prev, content: content.slice(0, from) + text + content.slice(to) };
    });
    const anchor = clampIndex(start, length);
    pendingSelectionRef.current = {
      start: anchor + (selection?.start ?? text.length),
      end: anchor + (selection?.end ?? text.length),
    };
    setDirty(true);
    // AI 结果在预览 tab 里看不到：成功后切回编辑，让用户直接确认/继续修改
    setEditorTab('edit');
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
      // 只替换正文选区：标题/摘要/标签等其它未保存字段保持原样；结果选中便于二次修改
      replaceContentRange(start, end, text, { start: 0, end: text.length });
      showToast('已用 AI 润色结果替换选中文字', 'success');
    } catch (err) {
      // service 已把 AI_* / step-up / 字段校验错误翻译成中文，这里原样透出
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
                  type="button"
                  onClick={handleAiMeta}
                  disabled={assisting !== null}
                  aria-busy={assisting === 'meta'}
                  className={cn(BTN_BASE, BTN_QUIET, 'min-h-8 px-2.5 text-[12px]')}
                >
                  {assisting === 'meta' ? '生成中…' : 'AI 标题/摘要/标签'}
                </button>
                <button
                  type="button"
                  onClick={handleAiPolish}
                  disabled={assisting !== null}
                  aria-busy={assisting === 'polish'}
                  className={cn(BTN_BASE, BTN_QUIET, 'min-h-8 px-2.5 text-[12px]')}
                >
                  {assisting === 'polish' ? '生成中…' : 'AI 润色'}
                </button>
                <button
                  type="button"
                  onClick={handleAiContinue}
                  disabled={assisting !== null}
                  aria-busy={assisting === 'continue'}
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
                        onClick={() => openMediaPicker('cover')}
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
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor="post-manager-content" className={cn(LABEL_CLS, 'mb-0')}>内容</label>
                  <div
                    role="tablist"
                    aria-label="正文视图"
                    className="flex overflow-hidden rounded-[3px] border border-[var(--sf-line)]"
                  >
                    {EDITOR_TABS.map((tab) => {
                      const selected = editorTab === tab;
                      return (
                        <button
                          key={tab}
                          ref={tab === 'edit' ? editTabRef : previewTabRef}
                          type="button"
                          role="tab"
                          id={`post-manager-tab-${tab}`}
                          aria-selected={selected}
                          aria-controls={`post-manager-tabpanel-${tab}`}
                          tabIndex={selected ? 0 : -1}
                          onClick={() => setEditorTab(tab)}
                          onKeyDown={handleEditorTabKeyDown}
                          className={cn(
                            'min-h-8 px-2.5 font-mono text-[11px] tracking-[0.06em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)]',
                            selected
                              ? 'bg-[var(--sf-accent)] text-[var(--sf-on-accent)]'
                              : 'bg-[var(--sf-surface)] text-[var(--sf-ink-2)] hover:text-[var(--sf-ink)]',
                          )}
                        >
                          {tab === 'edit' ? '编辑' : '预览'}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div
                  role="tabpanel"
                  id="post-manager-tabpanel-edit"
                  aria-labelledby="post-manager-tab-edit"
                  hidden={editorTab !== 'edit'}
                  className="min-w-0"
                >
                  {/* Markdown 格式化工具条：按钮统一用 aria-label 暴露动作名 */}
                  <div role="toolbar" aria-label="Markdown 格式工具" className="mb-2 flex flex-wrap items-center gap-1">
                    <FormatButton
                      action="bold"
                      label="加粗"
                      shortcut="Ctrl/Cmd+B"
                      visible={<strong>B</strong>}
                      onAction={applyMarkdownAction}
                    />
                    <FormatButton
                      action="italic"
                      label="斜体"
                      shortcut="Ctrl/Cmd+I"
                      visible={<em>I</em>}
                      onAction={applyMarkdownAction}
                    />
                    <FormatButton
                      action="inlineCode"
                      label="行内代码"
                      shortcut="Ctrl/Cmd+E"
                      visible="code"
                      onAction={applyMarkdownAction}
                    />
                    <FormatButton
                      action="codeBlock"
                      label="代码块"
                      shortcut="Shift+Enter"
                      visible="```"
                      onAction={applyMarkdownAction}
                    />
                    <select
                      aria-label="代码块语言"
                      title="代码块语言"
                      value={codeLanguage}
                      onChange={(event) => setCodeLanguage(event.target.value)}
                      className="h-8 rounded-[2px] border border-[var(--sf-line)] bg-[var(--sf-surface)] px-1 font-mono text-[11px] text-[var(--sf-ink-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)]"
                    >
                      {CODE_LANGUAGES.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <FormatButton
                      action="link"
                      label="链接"
                      shortcut="Ctrl/Cmd+K"
                      visible="link"
                      onAction={applyMarkdownAction}
                    />
                    <button
                      type="button"
                      aria-label="图片"
                      title="图片（复用媒体库）"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => openMediaPicker('content')}
                      className={FORMAT_BTN_CLS}
                    >
                      img
                    </button>
                    <FormatButton action="table" label="表格" visible="table" onAction={applyMarkdownAction} />
                    <FormatButton action="quote" label="引用" visible="quote" onAction={applyMarkdownAction} />
                    <FormatButton action="unorderedList" label="无序列表" visible="ul" onAction={applyMarkdownAction} />
                    <FormatButton action="orderedList" label="有序列表" visible="ol" onAction={applyMarkdownAction} />
                    {/* aria-label 用「插入标题」而不是「标题」：后者会与文章标题输入框的
                        label 撞名，令 getByLabelText('标题') 出现歧义（无障碍名称也更容易区分） */}
                    <FormatButton action="heading" label="插入标题" visible="h" onAction={applyMarkdownAction} />
                    <select
                      aria-label="标题级别"
                      title="标题级别"
                      value={headingLevel}
                      onChange={(event) => setHeadingLevel(Number(event.target.value) || 2)}
                      className="h-8 rounded-[2px] border border-[var(--sf-line)] bg-[var(--sf-surface)] px-1 font-mono text-[11px] text-[var(--sf-ink-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)]"
                    >
                      {HEADING_LEVELS.map((level) => (
                        <option key={level} value={level}>H{level}</option>
                      ))}
                    </select>
                  </div>

                  <textarea
                    id="post-manager-content"
                    ref={contentRef}
                    value={editing.content || ''}
                    onChange={(e) => { setEditing({ ...editing, content: e.target.value }); setDirty(true); }}
                    onKeyDown={handleContentKeyDown}
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

                <div
                  role="tabpanel"
                  id="post-manager-tabpanel-preview"
                  aria-labelledby="post-manager-tab-preview"
                  hidden={editorTab !== 'preview'}
                  tabIndex={0}
                  className="max-h-[50vh] min-h-[240px] min-w-0 overflow-auto rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] px-3 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)]"
                >
                  {editorTab === 'preview' ? (
                    <MarkdownPreview content={editing.content || ''} />
                  ) : null}
                </div>
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
            aria-label={mediaTarget === 'content' ? '选择正文图片' : '选择封面图片'}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)]"
          >
            <div className="flex items-center justify-between gap-2 border-b border-[var(--sf-line)] px-3 py-2.5 sm:px-4">
              <h3 className="break-words text-sm font-bold tracking-tight text-[var(--sf-ink)]">
                {mediaTarget === 'content' ? '选择正文图片' : '选择封面图片'}
              </h3>
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
              <MediaLibrary onSelect={handleMediaSelect} onClose={closeMediaLibrary} />
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
