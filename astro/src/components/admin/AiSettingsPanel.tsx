import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useAiSettings } from '../../hooks/domains/useAiSettings';
import type { AiArticlePublishMode, AiCommentMode, AiSettingsInput } from '../../lib/services/aiSettingsService';
import { cn } from '../../lib/utils';

const labelCls = 'mb-1.5 block font-mono text-xs uppercase tracking-wide text-text-secondary';
const inputCls = 'min-h-10 w-full min-w-0 rounded-md border border-border bg-bg-soft px-3 py-2.5 text-sm text-text outline-none focus:border-accent focus:bg-white';

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
      className="flex min-h-10 w-full items-start justify-between gap-3 rounded-md border border-border bg-white p-4 text-left transition-colors hover:border-border-hover hover:bg-bg-soft sm:items-center sm:gap-4"
      aria-pressed={checked}
    >
      <span className="min-w-0">
        <span className="block break-words text-sm font-semibold text-text [overflow-wrap:anywhere]">{label}</span>
        <span className="mt-1 block break-words text-xs leading-5 text-text-secondary [overflow-wrap:anywhere]">{description}</span>
      </span>
      <span className={cn('relative h-6 w-11 shrink-0 rounded-full border transition-colors', checked ? 'border-accent bg-accent' : 'border-border bg-bg-soft')}>
        <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform', checked ? 'translate-x-5' : 'translate-x-0.5')} />
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
        'flex w-full cursor-pointer items-start gap-3 rounded-md border p-3 text-left transition-colors focus-within:border-accent',
        selected ? 'border-accent bg-accent/5' : 'border-border bg-white hover:border-border-hover hover:bg-bg-soft',
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
      <span className={cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border', selected ? 'border-accent' : 'border-border')} aria-hidden="true">
        {selected && <span className="h-2 w-2 rounded-full bg-accent" />}
      </span>
      <span className="min-w-0">
        <span className="block break-words text-sm font-semibold text-text [overflow-wrap:anywhere]">{title}</span>
        <span className="mt-0.5 block break-words text-xs leading-5 text-text-secondary [overflow-wrap:anywhere]">{description}</span>
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
      <div className="mx-auto max-w-5xl space-y-4">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-md bg-bg-soft" />)}
      </div>
    );
  }

  // 读取失败时 form 仍为 null：给出可重试的错误态，避免永久骨架屏
  if (!form) {
    return (
      <div className="mx-auto max-w-5xl">
        <div className="card rounded-md p-5 shadow-xs">
          <h2 className="text-sm font-black text-text">无法读取 AI 配置</h2>
          <p className="mt-2 break-words text-sm text-danger [overflow-wrap:anywhere]">{error || '请稍后重试'}</p>
          <button type="button" onClick={() => void load()} className="btn-ghost mt-4 min-h-10 rounded-md text-xs">
            重新加载
          </button>
        </div>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mx-auto min-w-0 max-w-5xl space-y-4">
      <p className="text-sm text-text-secondary">接入任意 OpenAI 兼容端点（DeepSeek、new-api / one-api 自建网关等），用于文章生成与评论管理。密钥加密存储于服务端，任何接口都不回传明文。</p>

      {showBanner && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-danger/25 bg-danger/10 px-4 py-3 text-sm text-danger">
          <span>{error}</span>
          <button type="button" onClick={dismissMessages} className="shrink-0 text-danger/70 hover:text-danger" aria-label="关闭错误提示">✕</button>
        </div>
      )}

      {/* 接入配置 */}
      <section className="card max-w-full overflow-hidden rounded-md p-4 shadow-xs sm:p-5">
        <div className="mb-4 flex flex-col items-start justify-between gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="min-w-0">
            <h2 className="break-words text-sm font-black text-text [overflow-wrap:anywhere]">接入配置</h2>
            <p className="mt-1 break-words text-xs leading-5 text-text-secondary [overflow-wrap:anywhere]">上游模型服务地址、密钥与超时。未启用时 AI 相关功能全部停用。</p>
          </div>
          <span className={cn(
            'shrink-0 rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase',
            configured && enabled
              ? 'border-success/25 bg-success/10 text-success'
              : configured
                ? 'border-warning/25 bg-warning/10 text-warning'
                : 'border-border bg-bg-soft text-muted',
          )}>
            {configured ? (enabled ? '已启用' : '已配置未启用') : '未配置'}
          </span>
        </div>

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
            <p className="mt-1 text-xs text-muted">10 - 110 秒。服务端为同步阻塞调用，超时上限 110 秒。</p>
          </div>
          <div className="flex flex-col justify-end gap-2">
            <button
              type="button"
              onClick={() => void handleTest()}
              disabled={testing || !configured || !enabled}
              className="btn-ghost min-h-10 w-full rounded-md text-xs disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {testing && <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-border border-t-accent" aria-hidden="true" />}
              {testing ? '测试中...' : '测试连接'}
            </button>
            {testResult?.ok && (
              <p className="text-xs text-success">
                连接正常 · 耗时 <span className="font-mono">{testResult.latency_ms}</span>ms · 模型 <span className="font-mono">{testResult.model}</span>
              </p>
            )}
            {testResult && !testResult.ok && (
              <p className="text-xs text-danger">{error || testResult.message || '连接失败'}</p>
            )}
            {!testResult && !configured && <p className="text-xs text-muted">保存配置并启用后可测试连通性。</p>}
          </div>
        </div>
        {settings?.updated_at && (
          <p className="mt-3 text-xs text-muted">上次更新：<span className="font-mono">{settings.updated_at.replace(' ', 'T')}</span></p>
        )}
      </section>

      {/* 文章生成 */}
      <section className="card max-w-full overflow-hidden rounded-md p-4 shadow-xs sm:p-5">
        <div className="mb-4 border-b border-border pb-3">
          <h2 className="break-words text-sm font-black text-text [overflow-wrap:anywhere]">文章生成</h2>
          <p className="mt-1 break-words text-xs leading-5 text-text-secondary [overflow-wrap:anywhere]">AI 一键成文后的落库状态。草稿模式可在后台预览修改后再上线。</p>
        </div>
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
      </section>

      {/* 评论管家 */}
      <section className="card max-w-full overflow-hidden rounded-md p-4 shadow-xs sm:p-5">
        <div className="mb-4 border-b border-border pb-3">
          <h2 className="break-words text-sm font-black text-text [overflow-wrap:anywhere]">评论管家</h2>
          <p className="mt-1 break-words text-xs leading-5 text-text-secondary [overflow-wrap:anywhere]">AI 参与评论审核与回复的程度，以及回复身份与违禁词策略。</p>
        </div>

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

        <div className="mt-5 space-y-4 border-t border-border pt-4">
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
            <p className="mt-1 text-xs text-muted">当前 <span className="font-mono">{parseBannedWords(bannedWordsText).length}</span> 条；子串匹配且忽略大小写，命中时不向访客透露具体词。</p>
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
              <p className="mt-1 text-xs text-muted">AI 回复展示的评论者名称，留空则用默认「AI 助手」。</p>
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
      </section>

      <div className="flex flex-col items-stretch justify-end gap-2 sm:flex-row sm:items-center">
        {saved && <span className="text-xs text-success sm:mr-2">AI 配置已保存</span>}
        <button type="button" onClick={() => void handleSave()} disabled={saving} className="btn-primary min-h-10 w-full rounded-md text-xs disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto">
          {saving ? '保存中...' : saved ? '已保存' : '保存设置'}
        </button>
      </div>
    </motion.div>
  );
}
