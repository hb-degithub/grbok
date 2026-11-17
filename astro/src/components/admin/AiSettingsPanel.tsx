import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useAiSettings } from '../../hooks/domains/useAiSettings';
import type { AiArticlePublishMode, AiCommentMode, AiSettingsInput } from '../../lib/services/aiSettingsService';
import { cn } from '../../lib/utils';

/* AI 设置（科幻简约 · 批次 C5）
   面板 surface 底 + 冷灰细线，圆角 3px；输入与 ui/Input.tsx 同一套；
   单选卡片选中用唯一强调色细线 + canvas 底；状态 chip 只走语义色（成功 emerald / 警告 amber / 中性 ink-3）。
   读取、保存、测试连接、密钥留空语义与全部文案保持不变。 */

const labelCls = 'mb-1.5 block font-mono text-[11px] tracking-[0.08em] text-[var(--sf-ink-3)]';
const inputCls =
  'min-h-[40px] w-full min-w-0 rounded-[3px] border border-[var(--sf-line-control)] bg-[var(--sf-surface)] px-3 py-2.5 text-[16px] leading-snug text-[var(--sf-ink)] outline-none transition-colors placeholder:text-[var(--sf-ink-3)] focus-visible:border-[var(--sf-accent)] focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)] disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm';

const PANEL = 'max-w-full overflow-hidden rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)]';
const PANEL_HEAD = 'border-b border-[var(--sf-line)] px-4 py-3 sm:px-5';
const PANEL_BODY = 'p-4 sm:p-5';

const CHIP = 'inline-flex shrink-0 items-center rounded-[2px] border px-1.5 py-0.5 font-mono text-[10px] leading-none tracking-[0.08em]';
const TONE = {
  neutral: 'border-[var(--sf-line)] text-[var(--sf-ink-3)]',
  success: 'border-emerald-600/45 text-emerald-700 dark:border-emerald-400/45 dark:text-emerald-300',
  warning: 'border-amber-600/45 text-amber-700 dark:border-amber-400/45 dark:text-amber-300',
  danger: 'border-[var(--sf-danger)] text-[var(--sf-danger)]',
} as const;

const BTN_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-[3px] border font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)] disabled:cursor-not-allowed disabled:opacity-60';
const BTN_PRIMARY = 'border-[var(--sf-accent)] bg-[var(--sf-accent)] text-[var(--sf-on-accent)] hover:border-[var(--sf-accent-ink)] hover:bg-[var(--sf-accent-ink)]';
const BTN_SECONDARY = 'border-[var(--sf-line-control)] bg-[var(--sf-surface)] text-[var(--sf-ink-2)] hover:border-[var(--sf-line-strong)] hover:text-[var(--sf-ink)]';

const PUBLISH_MODES: { value: AiArticlePublishMode; title: string; description: string }[] = [
  { value: 'draft', title: '存草稿（推荐）', description: 'AI 生成后进入草稿箱，人工确认再发布' },
  { value: 'published', title: '直接发布', description: '生成后立即上线' },
];

const COMMENT_MODES: { value: AiCommentMode; title: string; description: string }[] = [
  { value: 'off', title: '关闭', description: 'AI 不参与评论管理' },
  { value: 'manual', title: '仅建议', description: 'AI 给审核标记和回复草稿，全部人工执行' },
  { value: 'assist', title: '半自动（推荐）', description: 'AI 自动审核评论，回复先生成草稿待你确认' },
  { value: 'full_auto', title: '全自动', description: '审核与回复都自动执行并直接展示' },
];

function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (checked: boolean) => void; label: string; description: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex min-h-10 w-full items-start justify-between gap-3 rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-4 text-left transition-colors hover:border-[var(--sf-line-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)] sm:items-center sm:gap-4"
      aria-pressed={checked}
    >
      <span className="min-w-0">
        <span className="block break-words text-sm font-semibold text-[var(--sf-ink)] [overflow-wrap:anywhere]">{label}</span>
        <span className="mt-1 block break-words text-xs leading-5 text-[var(--sf-ink-3)] [overflow-wrap:anywhere]">{description}</span>
      </span>
      <span className={cn('inline-flex h-6 w-11 shrink-0 items-center rounded-[2px] border px-[3px] transition-colors', checked ? 'justify-end border-[var(--sf-accent)] bg-[var(--sf-accent)]' : 'justify-start border-[var(--sf-line-control)] bg-[var(--sf-canvas)]')}>
        <span className={cn('inline-block h-5 w-5 rounded-[1px] transition-colors', checked ? 'bg-[var(--sf-on-accent)]' : 'bg-[var(--sf-line-control)]')} aria-hidden="true" />
      </span>
    </button>
  );
}

function RadioCard<T extends string>({
  name,
  value,
  current,
  title,
  description,
  onSelect,
}: {
  name: string;
  value: T;
  current: T;
  title: string;
  description: string;
  onSelect: (value: T) => void;
}) {
  const selected = current === value;
  return (
    <label
      className={cn(
        'flex w-full cursor-pointer items-start gap-3 rounded-[3px] border p-3 text-left transition-colors focus-within:border-[var(--sf-accent)]',
        selected ? 'border-[var(--sf-accent)] bg-[var(--sf-canvas)]' : 'border-[var(--sf-line)] bg-[var(--sf-surface)] hover:border-[var(--sf-line-strong)]',
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={selected}
        onChange={() => onSelect(value)}
        className="sr-only"
      />
      <span className={cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border', selected ? 'border-[var(--sf-accent)]' : 'border-[var(--sf-line-control)]')} aria-hidden="true">
        {selected && <span className="h-2 w-2 rounded-full bg-[var(--sf-accent)]" />}
      </span>
      <span className="min-w-0">
        <span className="block break-words text-sm font-semibold text-[var(--sf-ink)] [overflow-wrap:anywhere]">{title}</span>
        <span className="mt-0.5 block break-words text-xs leading-5 text-[var(--sf-ink-3)] [overflow-wrap:anywhere]">{description}</span>
      </span>
    </label>
  );
}

function parseBannedWords(text: string): string[] {
  return text.split('\n').map((line) => line.trim()).filter(Boolean);
}

export default function AiSettingsPanel() {
  const { settings, loading, saving, saved, testing, testResult, error, load, save, test, dismissMessages } = useAiSettings();

  const [form, setForm] = useState<AiSettingsInput | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [bannedWordsText, setBannedWordsText] = useState('');

  useEffect(() => {
    if (!settings) return;
    setForm({
      enabled: settings.enabled,
      base_url: settings.base_url,
      api_key: '',
      model: settings.model,
      timeout_seconds: settings.timeout_seconds,
      article_publish_mode: settings.article_publish_mode,
      comment_mode: settings.comment_mode,
      banned_words_enabled: settings.banned_words_enabled,
      banned_words: settings.banned_words,
      reply_name: settings.reply_name,
      reply_persona: settings.reply_persona,
    });
    setBannedWordsText(settings.banned_words.join('\n'));
    setApiKey('');
  }, [settings]);

  const patch = <K extends keyof AiSettingsInput>(key: K, value: AiSettingsInput[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const hasKey = settings?.has_key === true;
  const configured = settings?.configured === true;
  const enabled = settings?.enabled === true;
  const showBanner = Boolean(error) && !testResult;

  const handleSave = async () => {
    if (!form) return;
    dismissMessages();
    try {
      await save({
        ...form,
        base_url: form.base_url.trim(),
        model: form.model.trim(),
        api_key: apiKey,
        timeout_seconds: Math.min(110, Math.max(10, Math.round(form.timeout_seconds) || 60)),
        banned_words: parseBannedWords(bannedWordsText),
        reply_name: form.reply_name.trim() || 'AI 助手',
        reply_persona: form.reply_persona.trim(),
      });
      setApiKey('');
    } catch {
      // 错误信息已由 hook 呈现
    }
  };

  const handleTest = async () => {
    dismissMessages();
    try {
      await test();
    } catch {
      // 错误信息已由 hook 呈现（含 testResult.ok === false 的上游错误码）
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4" aria-hidden="true">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-[3px] border border-[var(--sf-line-soft)] bg-[var(--sf-canvas)]" />)}
      </div>
    );
  }

  // 读取失败时 form 仍为 null：给出可重试的错误态，避免永久骨架屏
  if (!form) {
    return (
      <div className="mx-auto max-w-5xl">
        <div className="rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-5">
          <h2 className="text-sm font-semibold tracking-tight text-[var(--sf-ink)]">无法读取 AI 配置</h2>
          <p className="mt-2 break-words text-sm text-[var(--sf-danger)] [overflow-wrap:anywhere]">{error || '请稍后重试'}</p>
          <button type="button" onClick={() => void load()} className={cn(BTN_BASE, BTN_SECONDARY, 'mt-4 min-h-10 px-3 text-xs')}>
            重新加载
          </button>
        </div>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mx-auto min-w-0 max-w-5xl space-y-4">
      <p className="text-sm text-[var(--sf-ink-2)]">接入任意 OpenAI 兼容端点（DeepSeek、new-api / one-api 自建网关等），用于文章生成与评论管理。密钥加密存储于服务端，任何接口都不回传明文。</p>

      {showBanner && (
        <div className="flex items-start justify-between gap-3 rounded-[3px] border border-[var(--sf-danger)] px-4 py-3 text-sm text-[var(--sf-danger)]">
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{error}</span>
          <button type="button" onClick={dismissMessages} className="shrink-0 text-[var(--sf-danger)] transition-opacity hover:opacity-70" aria-label="关闭错误提示">✕</button>
        </div>
      )}

      {/* 接入配置 */}
      <section className={PANEL}>
        <div className="flex flex-col items-start justify-between gap-3 border-b border-[var(--sf-line)] px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
          <div className="min-w-0">
            <h2 className="break-words text-sm font-semibold tracking-tight text-[var(--sf-ink)] [overflow-wrap:anywhere]">接入配置</h2>
            <p className="mt-1 break-words text-xs leading-5 text-[var(--sf-ink-3)] [overflow-wrap:anywhere]">上游模型服务地址、密钥与超时。未启用时 AI 相关功能全部停用。</p>
          </div>
          <span className={cn(CHIP, configured && enabled ? TONE.success : configured ? TONE.warning : TONE.neutral)}>
            {configured ? (enabled ? '已启用' : '已配置未启用') : '未配置'}
          </span>
        </div>

        <div className={PANEL_BODY}>
          <div className="mb-4">
            <Toggle
              checked={form.enabled}
              onChange={(checked) => patch('enabled', checked)}
              label="启用 AI 功能"
              description="关闭后文章生成与评论管家全部停用；配置保留，可随时重新开启。"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor="ai-base-url">接口地址（base_url）</label>
              <input
                id="ai-base-url"
                type="text"
                value={form.base_url}
                onChange={(event) => patch('base_url', event.target.value)}
                placeholder="https://api.deepseek.com/v1 或自建 new-api 地址"
                autoComplete="off"
                className={cn(inputCls, 'font-mono')}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="ai-api-key">API Key{hasKey ? '（留空表示不修改）' : ''}</label>
              <input
                id="ai-api-key"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={hasKey ? '已保存，留空不修改' : '首次配置必填'}
                autoComplete="new-password"
                className={cn(inputCls, 'font-mono')}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="ai-model">模型名称</label>
              <input
                id="ai-model"
                type="text"
                value={form.model}
                onChange={(event) => patch('model', event.target.value)}
                placeholder="deepseek-chat"
                autoComplete="off"
                className={cn(inputCls, 'font-mono')}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="ai-timeout">超时时间（秒）</label>
              <input
                id="ai-timeout"
                type="number"
                min={10}
                max={110}
                value={form.timeout_seconds}
                onChange={(event) => patch('timeout_seconds', Number.parseInt(event.target.value, 10) || 60)}
                className={cn(inputCls, 'font-mono')}
              />
              <p className="mt-1 text-xs text-[var(--sf-ink-3)]">10 - 110 秒。服务端为同步阻塞调用，超时上限 110 秒。</p>
            </div>
            <div className="flex flex-col justify-end gap-2">
              <button
                type="button"
                onClick={() => void handleTest()}
                disabled={testing || !configured || !enabled}
                className={cn(BTN_BASE, BTN_SECONDARY, 'min-h-10 w-full px-3 text-xs sm:w-auto')}
              >
                {testing && <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-[var(--sf-line)] border-t-[var(--sf-accent)]" aria-hidden="true" />}
                {testing ? '测试中...' : '测试连接'}
              </button>
              {testResult?.ok && (
                <p className="text-xs text-emerald-700 dark:text-emerald-300">
                  连接正常 · 耗时 <span className="font-mono">{testResult.latency_ms}</span>ms · 模型 <span className="font-mono">{testResult.model}</span>
                </p>
              )}
              {testResult && !testResult.ok && (
                <p className="break-words text-xs text-[var(--sf-danger)] [overflow-wrap:anywhere]">{error || testResult.message || '连接失败'}</p>
              )}
              {!testResult && !configured && <p className="text-xs text-[var(--sf-ink-3)]">保存配置并启用后可测试连通性。</p>}
            </div>
          </div>
          {settings?.updated_at && (
            <p className="mt-3 text-xs text-[var(--sf-ink-3)]">上次更新：<span className="font-mono">{settings.updated_at.replace(' ', 'T')}</span></p>
          )}
        </div>
      </section>

      {/* 文章生成 */}
      <section className={PANEL}>
        <div className={PANEL_HEAD}>
          <h2 className="break-words text-sm font-semibold tracking-tight text-[var(--sf-ink)] [overflow-wrap:anywhere]">文章生成</h2>
          <p className="mt-1 break-words text-xs leading-5 text-[var(--sf-ink-3)] [overflow-wrap:anywhere]">AI 一键成文后的落库状态。草稿模式可在后台预览修改后再上线。</p>
        </div>
        <div className={PANEL_BODY}>
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="文章生成发布模式">
            {PUBLISH_MODES.map((mode) => (
              <RadioCard
                key={mode.value}
                name="article_publish_mode"
                value={mode.value}
                current={form.article_publish_mode}
                title={mode.title}
                description={mode.description}
                onSelect={(value) => patch('article_publish_mode', value)}
              />
            ))}
          </div>
        </div>
      </section>

      {/* 评论管家 */}
      <section className={PANEL}>
        <div className={PANEL_HEAD}>
          <h2 className="break-words text-sm font-semibold tracking-tight text-[var(--sf-ink)] [overflow-wrap:anywhere]">评论管家</h2>
          <p className="mt-1 break-words text-xs leading-5 text-[var(--sf-ink-3)] [overflow-wrap:anywhere]">AI 参与评论审核与回复的程度，以及回复身份与违禁词策略。</p>
        </div>

        <div className={PANEL_BODY}>
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="评论管家模式">
            {COMMENT_MODES.map((mode) => (
              <RadioCard
                key={mode.value}
                name="comment_mode"
                value={mode.value}
                current={form.comment_mode}
                title={mode.title}
                description={mode.description}
                onSelect={(value) => patch('comment_mode', value)}
              />
            ))}
          </div>

          <div className="mt-5 space-y-4 border-t border-[var(--sf-line)] pt-4">
            <Toggle
              checked={form.banned_words_enabled}
              onChange={(checked) => patch('banned_words_enabled', checked)}
              label="启用违禁词拦截"
              description="命中违禁词的评论直接拒绝提交，任何评论模式下都生效。词表只在服务端匹配，不下发前台。"
            />
            <div>
              <label className={labelCls} htmlFor="ai-banned-words">违禁词表（每行一词）</label>
              <textarea
                id="ai-banned-words"
                value={bannedWordsText}
                onChange={(event) => setBannedWordsText(event.target.value)}
                rows={5}
                placeholder={'加微信\n代开发票'}
                className={cn(inputCls, 'font-mono')}
              />
              <p className="mt-1 text-xs text-[var(--sf-ink-3)]">当前 <span className="font-mono">{parseBannedWords(bannedWordsText).length}</span> 条；子串匹配且忽略大小写，命中时不向访客透露具体词。</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelCls} htmlFor="ai-reply-name">回复身份名称</label>
                <input
                  id="ai-reply-name"
                  type="text"
                  value={form.reply_name}
                  onChange={(event) => patch('reply_name', event.target.value)}
                  placeholder="AI 助手"
                  className={inputCls}
                />
                <p className="mt-1 text-xs text-[var(--sf-ink-3)]">AI 回复展示的评论者名称，留空则用默认「AI 助手」。</p>
              </div>
              <div className="sm:row-span-1">
                <label className={labelCls} htmlFor="ai-reply-persona">回复人设提示词</label>
                <textarea
                  id="ai-reply-persona"
                  value={form.reply_persona}
                  onChange={(event) => patch('reply_persona', event.target.value)}
                  rows={3}
                  placeholder="留空使用默认人设（友好、专业、简洁，与博客作者语气一致）"
                  className={inputCls}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="flex flex-col items-stretch justify-end gap-2 sm:flex-row sm:items-center">
        {saved && <span className="text-xs text-emerald-700 dark:text-emerald-300 sm:mr-2">AI 配置已保存</span>}
        <button type="button" onClick={() => void handleSave()} disabled={saving} className={cn(BTN_BASE, BTN_PRIMARY, 'min-h-10 w-full px-3 text-xs sm:w-auto')}>
          {saving ? '保存中...' : saved ? '已保存' : '保存设置'}
        </button>
      </div>
    </motion.div>
  );
}
