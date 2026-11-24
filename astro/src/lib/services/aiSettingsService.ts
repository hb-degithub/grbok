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

/** 后端 INVALID_AI_CONFIG 会带上的字段名（data.field） */
export type AiConfigField =
  | 'base_url'
  | 'model'
  | 'api_key'
  | 'article_publish_mode'
  | 'comment_mode'
  | 'reply_name'
  | 'reply_persona'
  | 'banned_words';

/** 字段 → 人话标签（错误提示与诊断列表共用，避免用户盯着下划线字段名） */
export const AI_CONFIG_FIELD_LABELS: Record<AiConfigField, string> = {
  base_url: '接口地址',
  model: '模型名称',
  api_key: 'API Key',
  article_publish_mode: '文章发布模式',
  comment_mode: '评论管家模式',
  reply_name: '回复身份名称',
  reply_persona: '回复人设提示词',
  banned_words: '违禁词表',
};

/**
 * 字段级校验规则的人话解释（与 pb_hooks/lib/ai_config.js 的 invalid() 调用点一一对应）。
 * 后端 INVALID_AI_CONFIG 只回传字段名与稳定码，不回传规则文案，所以由前端补一句可操作的说明。
 */
const AI_CONFIG_FIELD_REASONS: Record<AiConfigField, string> = {
  base_url: '必须是 http(s) 开头的完整地址，不含空格、查询串、# 片段或 .. 路径；origin 还需在服务端白名单 AI_ALLOWED_ORIGINS 中',
  model: '模型名称不能超过 120 个字符；启用 AI 时不能为空',
  api_key: '首次配置必须填写，且不超过 512 个字符',
  article_publish_mode: '只能是「存草稿」或「直接发布」',
  comment_mode: '只能是「关闭 / 仅建议 / 半自动 / 全自动」之一',
  reply_name: '回复身份名称不能超过 50 个字符',
  reply_persona: '回复人设提示词不能超过 2000 个字符',
  banned_words: '违禁词不能超过 500 条，单条不超过 100 个字符',
};

const AI_CONFIG_FIELDS = Object.keys(AI_CONFIG_FIELD_LABELS) as AiConfigField[];

/** 字段级校验失败的解析结果：字段名 + 人话标签 + 可操作原因 + 展示文案 */
export interface AiConfigFieldError {
  field: AiConfigField;
  label: string;
  reason: string;
  message: string;
}

/** /api/blog-admin/ai/diagnostics 的响应（后端并行实现，前端做防御式归一化） */
export interface AiDiagnosticError {
  field: string;
  reason: string;
}

export interface AiDiagnosticsEffective {
  base_url: string;
  origin_allowed: boolean;
  model: string;
  has_key: boolean;
  enabled: boolean;
}

export interface AiDiagnostics {
  ok: boolean;
  errors: AiDiagnosticError[];
  effective: AiDiagnosticsEffective;
}

const SETTINGS_PATH = '/api/blog-admin/ai/settings';
const TEST_PATH = '/api/blog-admin/ai/test';
const DIAGNOSTICS_PATH = '/api/blog-admin/ai/diagnostics';

const STABLE_CODE = /^[A-Z][A-Z0-9_]{2,}$/;

function isAiConfigField(value: unknown): value is AiConfigField {
  return typeof value === 'string' && (AI_CONFIG_FIELDS as string[]).includes(value);
}

function readErrorResponse(error: unknown): { data?: Record<string, unknown>; message: string } {
  const err = error as {
    response?: { data?: Record<string, unknown>; message?: unknown };
    data?: Record<string, unknown>;
    message?: unknown;
  } | null | undefined;
  const data = err?.response?.data ?? err?.data;
  const messageCandidates = [data?.message, err?.response?.message, err?.message];
  const message = messageCandidates.find((value): value is string => typeof value === 'string' && value.length > 0) ?? '';
  return { data, message };
}

/**
 * 抽取 INVALID_AI_CONFIG 的字段名。
 *
 * 新契约：响应 data.field 直接给出字段；旧后端（尚在滚动发布）只在 message 里写
 * `INVALID_AI_CONFIG: base_url`，因此这里做两层兼容。无法识别时返回 ''。
 */
export function aiConfigField(error: unknown): AiConfigField | '' {
  const { data, message } = readErrorResponse(error);
  const rawField = data?.field;
  if (isAiConfigField(rawField)) return rawField;

  // 兜底：'INVALID_AI_CONFIG: base_url' 冒号后的字段名
  if (aiErrorCode(error) === 'INVALID_AI_CONFIG') {
    const tail = message.split(':').slice(1).join(':').trim();
    if (isAiConfigField(tail)) return tail;
  }
  return '';
}

/** 后端若额外带了 reason/detail 文案就优先使用，否则用前端规则映射 */
function readFieldReason(error: unknown, field: AiConfigField): string {
  const { data } = readErrorResponse(error);
  for (const key of ['reason', 'detail'] as const) {
    const value = data?.[key];
    if (typeof value === 'string' && value.trim() && !STABLE_CODE.test(value.trim())) return value.trim();
  }
  return AI_CONFIG_FIELD_REASONS[field];
}

/**
 * 把带字段信息的保存错误翻译成「配置校验失败：字段（原因）」。
 * 没有字段信息时返回 null，调用方退回通用错误文案。
 */
export function describeAiConfigFieldError(error: unknown): AiConfigFieldError | null {
  const field = aiConfigField(error);
  if (!field) return null;
  const label = AI_CONFIG_FIELD_LABELS[field];
  const reason = readFieldReason(error, field);
  return {
    field,
    label,
    reason,
    message: `配置校验失败：${label}（${reason}）`,
  };
}

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

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** 诊断响应防御式归一化：后端仍在并行实现，字段缺失时不能把面板打崩 */
export function normalizeDiagnostics(raw: unknown): AiDiagnostics {
  const data = (raw ?? {}) as { ok?: unknown; errors?: unknown; effective?: unknown };
  const effectiveRaw = (data.effective ?? {}) as Record<string, unknown>;
  const errors = Array.isArray(data.errors)
    ? data.errors
        .map((item) => {
          const err = (item ?? {}) as { field?: unknown; reason?: unknown };
          return { field: asText(err.field), reason: asText(err.reason) };
        })
        .filter((err) => err.field.length > 0 || err.reason.length > 0)
    : [];

  return {
    ok: data.ok === true && errors.length === 0,
    errors,
    effective: {
      base_url: asText(effectiveRaw.base_url),
      origin_allowed: effectiveRaw.origin_allowed === true,
      model: asText(effectiveRaw.model),
      has_key: effectiveRaw.has_key === true,
      enabled: effectiveRaw.enabled === true,
    },
  };
}

/**
 * 运行配置诊断：返回字段级 errors 与生效配置（白名单/密钥是否就绪）。
 * 与保存解耦——诊断只读，不会改动已保存配置。
 */
export async function diagnoseAiSettings(): Promise<AiDiagnostics> {
  const pb = getPocketBase();
  const raw = await requestAi(
    () => withAuthRequestHeaders(pb, () => pb.send<unknown>(DIAGNOSTICS_PATH, { method: 'GET' })),
    '运行 AI 配置诊断失败',
  );
  return normalizeDiagnostics(raw);
}
