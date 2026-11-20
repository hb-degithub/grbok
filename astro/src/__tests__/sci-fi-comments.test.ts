// @vitest-environment node
// 只读源码文本的静态契约测试；node 环境才能直接使用 node:fs（jsdom 会 externalize）。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 文章评论区「科幻简约」统一的静态契约。
 *
 * 这一层只锁定两类东西，不假装验证运行时行为：
 *   1. 业务契约没有在视觉改造里被顺手删掉：useComments / useSiteSettings 的
 *      数据源、提交/回复/举报/编辑/删除/验证码/点赞调用、表单 id 与
 *      maxLength/required、嵌套递归、role=alert/status、aria-expanded/controls；
 *   2. 设计语言统一：结构色走 var(--sf-*)，细线 + 小圆角，移除
 *      card / glass / 重阴影 / 渐变 / 大圆角 / 旧 zinc-teal 调色板；
 *      但语义红/绿（错误/成功）仍然可辨识。
 *
 * 依据：docs/superpowers/specs/2026-11-17-sci-fi-site-wide-design.md 与
 * docs/superpowers/specs/2026-08-07-comment-system-enhancement-design.md。
 */

const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relPath: string) => readFileSync(resolve(SRC_ROOT, relPath), 'utf8');

const comments = {
  'CommentSection.tsx': read('components/comments/CommentSection.tsx'),
  'CommentItem.tsx': read('components/comments/CommentItem.tsx'),
  'CommentForm.tsx': read('components/comments/CommentForm.tsx'),
  'ReplyForm.tsx': read('components/comments/ReplyForm.tsx'),
} as const;

const COMMENT_FILES = Object.entries(comments);

/**
 * 旧结构色：改造后只允许石墨 + 冷灰 + 单一青色令牌。
 * 语义红/绿（red/emerald/amber）不计入旧调色板——它们表达成功/危险，必须保留。
 */
const LEGACY_PALETTE =
  /\b(?:bg|text|border|from|via|to|ring|outline|divide|placeholder|fill|stroke|shadow)-(?:zinc|neutral|stone|slate|gray|grey|teal|cyan|indigo|violet|purple|sky|blue)-\d{2,3}/;

/** 规格明确要移除的装饰：玻璃、旧卡片、重阴影、渐变、大圆角。 */
const FORBIDDEN_VISUALS: Array<{ label: string; pattern: RegExp }> = [
  { label: '玻璃拟态 backdrop-blur', pattern: /backdrop-blur/ },
  { label: '玻璃工具类 glass', pattern: /\bglass(?:-strong|-overlay)?\b/ },
  { label: '旧卡片类 card', pattern: /\bcard\b/ },
  { label: '阴影工具类 shadow-*', pattern: /\bshadow-(?:xs|sm|md|lg|xl|2xl|inner)\b/ },
  { label: '任意值阴影 shadow-[', pattern: /shadow-\[/ },
  { label: '大面积渐变', pattern: /(?:bg-gradient-to-|linear-gradient|radial-gradient)/ },
  { label: '大圆角 rounded-(md|lg|xl|2xl|3xl|full)', pattern: /\brounded-(?:md|lg|xl|2xl|3xl|full)\b/ },
  { label: '写死浅色底 bg-white', pattern: /\bbg-white\b/ },
  { label: '写死白字 text-white', pattern: /\btext-white\b/ },
  { label: '写死十六进制色值', pattern: /#[0-9a-fA-F]{3,8}\b/ },
  { label: 'rgba 光晕/玻璃底', pattern: /rgba?\(/ },
];

describe('评论区 · 数据与交互契约（视觉改造不得删）', () => {
  it('CommentSection 仍用 useComments/useSiteSettings，并保留分页、错误与关闭态', () => {
    const src = comments['CommentSection.tsx'];
    for (const token of [
      "import { useComments } from '../../hooks/useComments'",
      "import { useSiteSettings } from '../../hooks/useSiteSettings'",
      'useComments(postId, { enabled: commentsEnabled })',
      'const { comments, loading, loadingMore, error, submitError, page, totalPages, totalItems, hasMore, submitComment, refresh, loadMore } =',
      'const totalComments = countComments(comments);',
      '{totalComments} 条评论',
      'settings.comment_moderation',
      'userEmailVerified={userEmailVerified}',
      'serverError={submitError}',
      'onClick={() => refresh()}',
      'onClick={loadMore}',
      'disabled={loadingMore}',
      'totalItems - comments.length',
      'currentUserEmail={currentUserEmail}',
      'isNew={newCommentIds.has(comment.id)}',
      '评论已关闭',
      '加载评论失败',
      '还没有评论',
      'aria-busy="true"',
      'aria-live="polite"',
      '正在加载评论…',
      'role="alert"',
    ]) {
      expect(src, `CommentSection 契约丢失：${token}`).toContain(token);
    }
  });

  it('CommentSection 仍递归收集新评论 id 并按批次高亮 3 秒', () => {
    const src = comments['CommentSection.tsx'];
    for (const token of [
      'const collectIds = (items: typeof comments) =>',
      'allIds.add(item.id);',
      'if (item.children.length > 0) collectIds(item.children);',
      'const pageIncreased = page > prevPageRef.current;',
      'window.setTimeout(() =>',
      'newTimersRef',
      '3000',
      'setNewCommentIds((prev) =>',
    ]) {
      expect(src, `新评论高亮链路丢失：${token}`).toContain(token);
    }
  });

  it('CommentItem 保留 sanitizeText、点赞/举报/编辑/删除/验证码调用', () => {
    const src = comments['CommentItem.tsx'];
    for (const token of [
      "import { sanitizeText } from '../../lib/security'",
      'sanitizeText(comment.content)',
      'commentService.likeComment(comment.id)',
      'commentService.unlikeComment(comment.id)',
      'commentService.reportComment(comment.id, reportReason.trim())',
      'commentService.editComment(comment.id, editContent.trim(), editEmail, verificationCode.trim())',
      'commentService.deleteComment(comment.id, deleteEmail, deleteVerificationCode.trim())',
      'commentService.sendVerificationCode(editEmail.trim())',
      'commentService.sendVerificationCode(deleteEmail.trim())',
      'aria-pressed={isLiked}',
      '请先登录后再点赞',
      '操作过于频繁，请稍后再试',
    ]) {
      expect(src, `CommentItem 交互链路丢失：${token}`).toContain(token);
    }
  });

  it('CommentItem 保留作者/LevelBadge/AI 标记/时间与 isNew 提示', () => {
    const src = comments['CommentItem.tsx'];
    for (const token of [
      "import LevelBadge from '../ui/LevelBadge'",
      '{comment.author_level && <LevelBadge level={comment.author_level} size="sm" />}',
      'comment.author_name',
      'comment.is_ai',
      '该回复由 AI 生成',
      'formatTime(comment.created)',
      'isNew',
      'NEW',
    ]) {
      expect(src, `CommentItem 展示信息丢失：${token}`).toContain(token);
    }
  });

  it('CommentItem 保留 aria-expanded/controls、回复与嵌套递归结构', () => {
    const src = comments['CommentItem.tsx'];
    for (const token of [
      'aria-expanded={isReplyOpen}',
      'aria-controls={`reply-form-${comment.id}`}',
      'const canReply = depth < maxDepth;',
      'depth={depth + 1}',
      'maxDepth={maxDepth}',
      'comment.children.map',
      'comment.children.length > 0',
      '<ReplyForm',
      'onSubmitReply={onSubmitReply}',
      'moderationEnabled={moderationEnabled}',
      'serverError={serverError}',
      'border-l',
    ]) {
      expect(src, `嵌套/回复契约丢失：${token}`).toContain(token);
    }
  });

  it('CommentForm 保留 id/maxLength/required 与全部校验分支', () => {
    const src = comments['CommentForm.tsx'];
    for (const token of [
      'id="comment-content"',
      'rows={4}',
      'maxLength={CONTENT_MAX}',
      'required',
      'noValidate',
      'commentLimiter.tryConsume()',
      "'请填写昵称和评论内容'",
      "'邮箱格式不正确'",
      '操作太频繁，请稍后再试',
      'formData.author_name.length > NAME_MAX',
      'formData.content.length > CONTENT_MAX',
      'onSubmit({ ...formData, parent_id: null })',
      'userEmailVerified === false',
      'requestVerification(email)',
      'autoComplete="name"',
      'autoComplete="email"',
      'role="alert"',
      'role="status"',
    ]) {
      expect(src, `CommentForm 表单契约丢失：${token}`).toContain(token);
    }
  });

  it('ReplyForm 保留 reply-content id、maxLength/required 与全部校验分支', () => {
    const src = comments['ReplyForm.tsx'];
    for (const token of [
      "const contentId = `reply-content-${parentId ?? 'new'}`;",
      'id={contentId}',
      'rows={3}',
      'maxLength={CONTENT_MAX}',
      'required',
      'noValidate',
      'replyLimiter.tryConsume()',
      "'请填写昵称和回复内容'",
      "'邮箱格式不正确'",
      '操作太频繁，请稍后再试',
      'formData.author_name.length > NAME_MAX',
      'formData.content.length > CONTENT_MAX',
      'onSubmit({ ...formData, parent_id: parentId })',
      'onClose',
      'role="alert"',
      'role="status"',
      '审核后展示',
    ]) {
      expect(src, `ReplyForm 表单契约丢失：${token}`).toContain(token);
    }
  });

  it('四个组件都保持 default export 与 props 接口（不删字段）', () => {
    expect(comments['CommentSection.tsx']).toMatch(/export default function CommentSection\(\{ postId \}: CommentSectionProps\)/);
    expect(comments['CommentItem.tsx']).toMatch(/export default function CommentItem\(/);
    expect(comments['CommentForm.tsx']).toMatch(/export default function CommentForm\(/);
    expect(comments['ReplyForm.tsx']).toMatch(/export default function ReplyForm\(/);

    for (const token of [
      'interface CommentSectionProps',
      'postId: string;',
      'interface CommentItemProps',
      'comment: NestedComment;',
      'onSubmitReply: CommentSubmitHandler;',
      'currentUserEmail?: string;',
      'newCommentIds?: Set<string>;',
      'interface CommentFormProps',
      'userEmailVerified?: boolean;',
      'serverError?: string | null;',
      'interface ReplyFormProps',
      'isOpen: boolean;',
      'parentId?: string | null;',
    ]) {
      const source = comments['CommentSection.tsx'] + comments['CommentItem.tsx'] + comments['CommentForm.tsx'] + comments['ReplyForm.tsx'];
      expect(source, `props 字段被删：${token}`).toContain(token);
    }
  });
});

describe('评论区 · 科幻视觉契约', () => {
  it.each(COMMENT_FILES)('%s 结构色走 var(--sf-*) 令牌', (_name, src) => {
    expect((src.match(/var\(--sf-/g) ?? []).length, '--sf-* 令牌使用过少').toBeGreaterThan(5);
  });

  it.each(COMMENT_FILES)('%s 使用细线 + 小圆角（不再用大圆角/重阴影）', (_name, src) => {
    expect(src).toContain('border-[var(--sf-line');
    expect(src).toMatch(/rounded-\[(?:2|3)px\]/);
  });

  it.each(COMMENT_FILES)('%s 不再使用旧调色板（zinc/teal/indigo…）', (name, src) => {
    const hit = src.match(LEGACY_PALETTE);
    expect(hit?.[0] ?? null, `${name} 仍含旧调色板：${hit?.[0]}`).toBeNull();
  });

  it.each(COMMENT_FILES)('%s 不引入玻璃/旧卡片/重阴影/渐变/大圆角/写死色', (name, src) => {
    for (const { label, pattern } of FORBIDDEN_VISUALS) {
      expect(src, `${name} 仍包含${label}`).not.toMatch(pattern);
    }
  });

  it.each(COMMENT_FILES)('%s 不再写旧主题 dark: 结构色', (name, src) => {
    // 允许的唯一暗色变体是语义绿（成功提示）：结构色全部交给 .dark 令牌。
    const darkUses = src.match(/dark:[^\s"'`]+/g) ?? [];
    for (const use of darkUses) {
      expect(use, `${name} 出现非语义 dark: 变体 ${use}`).toMatch(/^dark:text-emerald-\d{3}$/);
    }
  });

  it('CommentItem 移除鼠标光晕与随机 zinc 头像色', () => {
    const src = comments['CommentItem.tsx'];
    for (const token of ['getAvatarColor', 'onMouseMove', 'mousePosition', 'isHovered', 'handleMouseMove', 'radial-gradient']) {
      expect(src, `残留纯装饰：${token}`).not.toContain(token);
    }
  });

  it('CommentSection 保留等宽短标签，视觉语言与全站一致', () => {
    expect(comments['CommentSection.tsx']).toContain('font-mono');
    expect(comments['CommentSection.tsx']).toContain('Comments / 01');
  });

  it('语义色未被消色：错误红 + 成功绿仍可辨识', () => {
    for (const [name, src] of COMMENT_FILES) {
      expect(src, `${name} 缺少语义错误色 var(--sf-danger)`).toContain('var(--sf-danger)');
    }
    expect(comments['CommentForm.tsx'], '提交成功提示仍应为绿色语义').toMatch(/text-emerald-(?:500|600)/);
    expect(comments['ReplyForm.tsx'], '回复成功提示仍应为绿色语义').toMatch(/text-emerald-(?:500|600)/);
    expect(comments['CommentItem.tsx'], '举报成功提示仍应为绿色语义').toMatch(/text-emerald-(?:500|600)/);
    expect(comments['CommentItem.tsx'], '点赞错误仍应为 role=alert').toMatch(/role="alert"/);
  });

  it('四个组件都不再引用 card / glass 工具类', () => {
    for (const [name, src] of COMMENT_FILES) {
      expect(src, `${name} 仍引用 card 类`).not.toMatch(/className="[^"]*\bcard\b/);
      expect(src, `${name} 仍引用 glass 类`).not.toMatch(/className="[^"]*\bglass(?:-strong|-overlay)?\b/);
    }
  });
});
