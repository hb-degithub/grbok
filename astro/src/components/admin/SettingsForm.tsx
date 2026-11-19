import React from 'react';
import { motion } from 'framer-motion';
import { useSettings } from '../../hooks/domains/useSettings';
import type { SiteSettings } from '../../lib/services/settingsService';

/* 站点设置（科幻简约 · 批次 C5）
   面板 = surface 底 + 细线；输入与 ui/Input.tsx 同一套（surface 底 / 控制线描边 / 强调色焦点环）。
   开关保留 aria-pressed 与 onClick；字段、校验、保存与提示文案一字未改。 */

const settingDescriptions: Record<keyof SiteSettings, string> = {
  site_title: '站点标题',
  site_description: '站点描述',
  site_logo: '站点 Logo URL',
  posts_per_page: '文章列表每页数量',
  enable_comments: '是否允许访客提交评论',
  comment_moderation: '新评论是否需要审核后展示',
  debug_protection_enabled: '前端调试干扰开关，仅用于威慑普通访客操作，不是安全边界',
};

const PANEL = 'max-w-full overflow-hidden rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)]';
const PANEL_HEAD = 'border-b border-[var(--sf-line)] px-4 py-3 sm:px-5';
const PANEL_BODY = 'p-4 sm:p-5';
const LABEL = 'mb-1.5 block font-mono text-[11px] tracking-[0.08em] text-[var(--sf-ink-3)]';
const INPUT =
  'min-h-[40px] w-full min-w-0 rounded-[3px] border border-[var(--sf-line-control)] bg-[var(--sf-surface)] px-3 py-2.5 text-[16px] leading-snug text-[var(--sf-ink)] outline-none transition-colors placeholder:text-[var(--sf-ink-3)] focus-visible:border-[var(--sf-accent)] focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)] disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm';

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
      <span className={`inline-flex h-6 w-11 shrink-0 items-center rounded-[2px] border px-[3px] transition-colors ${checked ? 'justify-end border-[var(--sf-accent)] bg-[var(--sf-accent)]' : 'justify-start border-[var(--sf-line-control)] bg-[var(--sf-canvas)]'}`}>
        <span className={`inline-block h-5 w-5 rounded-[1px] transition-colors ${checked ? 'bg-[var(--sf-on-accent)]' : 'bg-[var(--sf-line-control)]'}`} aria-hidden="true" />
      </span>
    </button>
  );
}

export default function SettingsForm() {
  const {
    settings,
    loading,
    error,
    retry,
    saving,
    saved,
    saveSettings,
    updateSetting,
  } = useSettings();

  if (loading) return (
    <div className="min-w-0 space-y-4" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-[3px] border border-[var(--sf-line-soft)] bg-[var(--sf-canvas)]" />
      ))}
    </div>
  );

  /* 加载失败：只显示错误与重试，不渲染表单（默认值不可保存，避免覆盖线上配置）。 */
  if (error) return (
    <div role="alert" className={PANEL}>
      <div className={PANEL_HEAD}>
        <h2 className="break-words text-sm font-semibold tracking-tight text-[var(--sf-ink)] [overflow-wrap:anywhere]">设置加载失败</h2>
        <p className="mt-1 break-words text-xs leading-5 text-[var(--sf-ink-3)] [overflow-wrap:anywhere]">未能读取站点设置，当前不可保存，避免默认值覆盖线上配置。重试成功后才能编辑。</p>
      </div>
      <div className={PANEL_BODY}>
        <p className="break-words text-sm text-[var(--sf-danger)] [overflow-wrap:anywhere]">{error}</p>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={retry}
            className="inline-flex min-h-10 w-full items-center justify-center rounded-[3px] border border-[var(--sf-accent)] bg-[var(--sf-accent)] px-3 text-xs font-medium text-[var(--sf-on-accent)] transition-colors hover:border-[var(--sf-accent-ink)] hover:bg-[var(--sf-accent-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)] sm:w-auto"
          >
            重试
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-w-0 space-y-4">
      <section className={PANEL}>
        <div className={PANEL_HEAD}>
          <h2 className="break-words text-sm font-semibold tracking-tight text-[var(--sf-ink)] [overflow-wrap:anywhere]">基础设置</h2>
          <p className="mt-1 break-words text-xs text-[var(--sf-ink-3)] [overflow-wrap:anywhere]">站点公开信息与内容列表配置。</p>
        </div>
        <div className={PANEL_BODY}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="settings-site-title" className={LABEL}>站点标题</label>
              <input id="settings-site-title" type="text" value={settings.site_title} onChange={(e) => updateSetting('site_title', e.target.value)} className={INPUT} />
            </div>
            <div>
              <label htmlFor="settings-posts-per-page" className={LABEL}>每页文章数</label>
              <input id="settings-posts-per-page" type="number" min={1} max={50} value={settings.posts_per_page} onChange={(e) => updateSetting('posts_per_page', parseInt(e.target.value) || 10)} className={INPUT} />
            </div>
          </div>
          <div className="mt-4">
            <label htmlFor="settings-site-description" className={LABEL}>站点描述</label>
            <textarea id="settings-site-description" value={settings.site_description} onChange={(e) => updateSetting('site_description', e.target.value)} rows={3} className={INPUT} />
          </div>
          <div className="mt-4">
            <label htmlFor="settings-site-logo" className={LABEL}>站点 Logo URL</label>
            <input id="settings-site-logo" type="text" value={settings.site_logo} onChange={(e) => updateSetting('site_logo', e.target.value)} placeholder="https://..." className={INPUT} />
            {settings.site_logo && <img src={settings.site_logo} alt="Logo 预览" className="mt-3 h-16 w-16 rounded-[2px] border border-[var(--sf-line)] bg-[var(--sf-canvas)] object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Toggle checked={settings.enable_comments} onChange={(checked) => updateSetting('enable_comments', checked)} label="启用评论" description="关闭后访客无法继续提交新评论。" />
        <Toggle checked={settings.comment_moderation} onChange={(checked) => updateSetting('comment_moderation', checked)} label="评论审核" description="开启后新评论进入待审核队列，通过后才公开展示。" />
      </section>

      <section className={PANEL}>
        <div className="flex flex-col items-start justify-between gap-3 border-b border-[var(--sf-line)] px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
          <div className="min-w-0">
            <h2 className="break-words text-sm font-semibold tracking-tight text-[var(--sf-ink)] [overflow-wrap:anywhere]">访问干扰</h2>
            <p className="mt-1 break-words text-xs leading-5 text-[var(--sf-ink-3)] [overflow-wrap:anywhere]">这只是前端干扰层，用来减少随手 F12、右键、查看源码等操作；真正的安全仍依赖 HTTPS、PocketBase 权限、服务端限流和密钥不出服务端。</p>
          </div>
          <span className="shrink-0 rounded-[2px] border border-amber-600/45 px-1.5 py-0.5 font-mono text-[10px] leading-none tracking-[0.08em] text-amber-700 dark:border-amber-400/45 dark:text-amber-300">可选</span>
        </div>
        <div className={PANEL_BODY}>
          <Toggle
            checked={settings.debug_protection_enabled}
            onChange={(checked) => updateSetting('debug_protection_enabled', checked)}
            label="启用调试干扰"
            description="拦截 F12、Ctrl+Shift+I/J/C、Ctrl+U、右键菜单，并在页面显示轻量提示。懂技术的人仍可绕过。"
          />
        </div>
      </section>

      <div className="flex justify-end">
        <button onClick={saveSettings} disabled={saving} className="inline-flex min-h-10 w-full items-center justify-center rounded-[3px] border border-[var(--sf-accent)] bg-[var(--sf-accent)] px-3 text-xs font-medium text-[var(--sf-on-accent)] transition-colors hover:border-[var(--sf-accent-ink)] hover:bg-[var(--sf-accent-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto">
          {saving ? '保存中...' : saved ? '已保存' : '保存设置'}
        </button>
      </div>
    </motion.div>
  );
}
