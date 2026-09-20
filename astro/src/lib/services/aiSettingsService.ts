import { getPocketBase } from '../pocketbase';
import { withAuthRequestHeaders } from '../security';
import { describePbError } from '../pb-error';
import { notifyStepUpExpired } from '../step-up-recovery';

export type AiArticlePublishMode = 'draft' | 'published';
export type AiCommentMode = 'off' | 'manual' | 'assist' | 'full_auto';

/** /api/blog-admin/ai/settings 返回的脱敏视图（绝不含明文 api_key） */
export interface AiSettings {
  configured: boolean;
  enabled: boolean;
  base_url: string;
  model: string;
  timeout_seconds: number;
  article_publish_mode: AiArticlePublishMode;
  comment_mode: AiCommentMode;
  banned_words_enabled: boolean;
  banned_words: string[];
  reply_name: string;
  reply_persona: string;
  has_key: boolean;
  updated_at: string;
}

export interface AiSettingsInput {
  enabled: boolean;
  base_url: string;
  /** 空字符串表示保留已保存的 key */
  api_key: string;
  model: string;
  timeout_seconds: number;
  article_publish_mode: AiArticlePublishMode;
  comment_mode: AiCommentMode;
  banned_words_enabled: boolean;
  banned_words: string[];
  reply_name: string;
  reply_persona: string;
}

export interface AiTestSuccess {
  ok: true;
  latency_ms: number;
  model: string;
  reply: string;
}

export interface AiTestFailure {
  ok: false;
  error: string;
  message: string;
}

export type AiTestResult = AiTestSuccess | AiTestFailure;

const SETTINGS_PATH = '/api/blog-admin/ai/settings';
const TEST_PATH = '/api/blog-admin/ai/test';

const STABLE_CODE = /^[A-Z][A-Z0-9_]{2,}$/;

/**
 * 抽取后端下发的稳定错误码，供上层做中文映射。
 * ai_client / ai_config 以 ApiError(状态码, 'AI_TIMEOUT: 上游响应超时') 抛错，稳定码是
 * message 前缀；PB JS SDK 包装为 ClientResponseError 后其 message 保留该前缀。
 * 返回空串表示无法识别（调用方退化为 describePbError）。
 */
export function aiErrorCode(error: unknown): string {
  const err = error as {
    response?: { data?: { code?: unknown; message?: unknown }; message?: unknown };
    data?: { code?: unknown; message?: unknown };
    message?: unknown;
  } | null | undefined;
  const data = err?.response?.data ?? err?.data;
  const candidates = [data?.code, data?.message, err?.response?.message, err?.message];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate) continue;
    const head = candidate.split(':')[0].trim();
    if (STABLE_CODE.test(head)) return head;
  }
  return '';
}

/**
 * AI 管理路由统一出口：step-up 会话过期时广播内联重验事件，
 * 其余错误原样抛出（保留 status / response.data，供上层 describePbError 翻译）。
 */
async function requestAi<T>(run: () => Promise<T>, fallback: string): Promise<T> {
  try {
    return await run();
  } catch (error) {
    notifyStepUpExpired(error);
    const err = error as { message?: unknown } | null | undefined;
    if (typeof err?.message === 'string' && err.message) throw error;
    // 非 Error 抛出物没有可读信息，退化为 describePbError 文案
    throw new Error(describePbError(error, fallback), { cause: error });
  }
}

export async function getAiSettings(): Promise<AiSettings> {
  const pb = getPocketBase();
  return requestAi(
    () => withAuthRequestHeaders(pb, () => pb.send<AiSettings>(SETTINGS_PATH, { method: 'GET' })),
    '无法读取 AI 配置',
  );
}

export async function saveAiSettings(input: AiSettingsInput): Promise<AiSettings> {
  const pb = getPocketBase();
  return requestAi(
    () => withAuthRequestHeaders(pb, () => pb.send<AiSettings>(SETTINGS_PATH, { method: 'PUT', body: input })),
    '保存 AI 配置失败',
  );
}

export async function testAiConnection(): Promise<AiTestResult> {
  const pb = getPocketBase();
  return requestAi(
    () => withAuthRequestHeaders(pb, () => pb.send<AiTestResult>(TEST_PATH, { method: 'POST' })),
    '测试连接失败',
  );
}
