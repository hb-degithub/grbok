/**
 * AI 辅助写作服务
 *
 * 对接 pb_hooks 的 AI 管理路由（可信管理 IP + step-up + super_admin 门槛）：
 *   POST /api/blog-admin/ai/article  一键成文（服务端 $http.send 同步阻塞，最长约 110s）
 *   POST /api/blog-admin/ai/assist   单步辅助（meta / polish / continue）
 * X-Admin-Step-Up、指纹等管理头由 pocketbase.ts 安装的 beforeSend 拦截器统一注入，pb.send 即可。
 *
 * 错误：后端 lib/ai_client.js 抛 ApiError，message 形如 'AI_TIMEOUT: ...'，
 * 此处把稳定错误码归一化为中文文案，并转发 step-up 过期事件（notifyStepUpExpired）。
 */

import { getPocketBase } from '../pocketbase';
import { withAuthRequestHeaders } from '../security';
import { describePbError } from '../pb-error';
import { notifyStepUpExpired } from '../step-up-recovery';

export type AiArticleLength = 'short' | 'medium' | 'long';
export type AiAssistAction = 'meta' | 'polish' | 'continue';

export interface GenerateArticleInput {
  topic: string;
  outline?: string;
  style?: string;
  length?: AiArticleLength;
}

export interface GeneratedArticle {
  id: string;
  slug: string;
  status: 'draft' | 'published';
  title: string;
  excerpt: string;
}

export interface AssistMetaResult {
  titles: string[];
  excerpt: string;
  tag_names: string[];
  seo_description: string;
}

export interface AssistTextResult {
  text: string;
}

const ARTICLE_PATH = '/api/blog-admin/ai/article';
const ASSIST_PATH = '/api/blog-admin/ai/assist';

/** 后端稳定错误码（lib/ai_client.js，前缀 AI_）→ 用户可读文案 */
const AI_ERROR_MESSAGES: Record<string, string> = {
  AI_NOT_CONFIGURED: '尚未启用 AI 接入，请先在 AI 设置中完成配置并启用',
  AI_TIMEOUT: 'AI 生成超时（上游响应超时），请稍后重试或改用更短篇幅',
  AI_RATE_LIMITED: 'AI 调用过于频繁，请稍后重试',
  AI_AUTH_FAILED: 'AI 接口鉴权失败，请检查 API Key 配置',
  AI_UPSTREAM_BUSY: 'AI 服务当前繁忙（上游限流），请稍后重试',
  AI_UPSTREAM_ERROR: 'AI 服务暂时不可用，请稍后重试',
  AI_BAD_RESPONSE: 'AI 返回内容无法解析，请重试',
};

function errorMessage(err: unknown): string {
  const value = (err as { message?: unknown } | null | undefined)?.message;
  return typeof value === 'string' ? value : '';
}

/** 把 AI_* 错误码翻译为中文；非 AI 错误（step-up 过期 / 校验 / 网络）交给 describePbError */
export function describeAiError(err: unknown, fallback: string): string {
  const message = errorMessage(err);
  const code = /^(AI_[A-Z0-9_]+)/.exec(message)?.[1] || '';
  if (code && AI_ERROR_MESSAGES[code]) return AI_ERROR_MESSAGES[code];
  return describePbError(err, message || fallback);
}

async function sendAi<T>(path: string, body: unknown, fallback: string): Promise<T> {
  const pb = getPocketBase();
  try {
    return await withAuthRequestHeaders(pb, () => pb.send<T>(path, { method: 'POST', body }));
  } catch (err) {
    notifyStepUpExpired(err);
    // 翻译后的文案给用户看，原错误挂在 cause 上保留堆栈
    throw new Error(describeAiError(err, fallback), { cause: err });
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

/** 一键成文：成功后文章已落库，返回记录摘要供前端拉取完整内容审阅 */
export async function generateArticle(input: GenerateArticleInput): Promise<GeneratedArticle> {
  const body: GenerateArticleInput = { topic: input.topic.trim() };
  const outline = input.outline?.trim();
  const style = input.style?.trim();
  if (outline) body.outline = outline;
  if (style) body.style = style;
  if (input.length) body.length = input.length;

  const data = await sendAi<Partial<GeneratedArticle>>(ARTICLE_PATH, body, 'AI 生成失败');
  return {
    id: asString(data?.id),
    slug: asString(data?.slug),
    status: data?.status === 'published' ? 'published' : 'draft',
    title: asString(data?.title),
    excerpt: asString(data?.excerpt),
  };
}

/** 生成标题 / 摘要 / 标签 / SEO 描述建议（不落库，由用户确认后回填） */
export async function assistMeta(title: string, content: string): Promise<AssistMetaResult> {
  const data = await sendAi<Partial<AssistMetaResult>>(
    ASSIST_PATH,
    { action: 'meta', title, content },
    'AI 标题/摘要生成失败',
  );
  return {
    titles: asStringArray(data?.titles),
    excerpt: asString(data?.excerpt),
    tag_names: asStringArray(data?.tag_names),
    seo_description: asString(data?.seo_description),
  };
}

/** 润色选中片段 */
export async function assistPolish(selection: string): Promise<AssistTextResult> {
  const data = await sendAi<Partial<AssistTextResult>>(
    ASSIST_PATH,
    { action: 'polish', selection },
    'AI 润色失败',
  );
  return readText(data);
}

/** 基于上下文续写 */
export async function assistContinue(content: string, selection: string): Promise<AssistTextResult> {
  const data = await sendAi<Partial<AssistTextResult>>(
    ASSIST_PATH,
    { action: 'continue', content, selection },
    'AI 续写失败',
  );
  return readText(data);
}

function readText(data: Partial<AssistTextResult> | undefined): AssistTextResult {
  const text = asString(data?.text);
  if (!text.trim()) throw new Error('AI 未返回有效内容，请重试');
  return { text };
}
