import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { getPocketBase } from '../../lib/pocketbase';
import { DEFAULT_SITE_SETTINGS, mergeSettingRecords, type SiteSettings } from '../../lib/site-settings';

const settingDescriptions: Record<keyof SiteSettings, string> = {
  site_title: '站点标题',
  site_description: '站点描述',
  site_logo: '站点 Logo URL',
  posts_per_page: '文章列表每页数量',
  enable_comments: '是否允许访客提交评论',
  comment_moderation: '新评论是否需要审核后展示',
  debug_protection_enabled: '前端调试干扰开关，仅用于威慑普通访客操作，不是安全边界',
};

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
      <span className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${checked ? 'border-accent bg-accent' : 'border-border bg-bg-soft'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </span>
    </button>
  );
}

export default function SettingsForm() {
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function load() {
      const pb = getPocketBase();
      try {
        const result = await pb.collection('settings').getFullList();
        setSettings(mergeSettingRecords(result as Array<{ key: string; value: unknown }>));
      } catch (err) {
        console.error('加载设置失败：', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const saveSettings = async () => {
    setSaving(true);
    const pb = getPocketBase();
    try {
      for (const [key, value] of Object.entries(settings)) {
        try {
          const existing = await pb.collection('settings').getFirstListItem(pb.filter('key = {:key}', { key }));
          await pb.collection('settings').update(existing.id, { value: String(value), description: settingDescriptions[key as keyof SiteSettings] || '' });
        } catch {
          await pb.collection('settings').create({ key, value: String(value), description: settingDescriptions[key as keyof SiteSettings] || '' });
        }
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('保存设置失败：', err);
      alert('保存设置失败。');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="min-w-0 space-y-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-md bg-bg-soft" />)}</div>;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-w-0 space-y-4">
      <section className="card max-w-full overflow-hidden rounded-md p-4 shadow-xs sm:p-5">
        <div className="mb-4 border-b border-border pb-3">
          <h2 className="break-words text-sm font-black text-text [overflow-wrap:anywhere]">基础设置</h2>
          <p className="mt-1 break-words text-xs text-text-secondary [overflow-wrap:anywhere]">站点公开信息与内容列表配置。</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block font-mono text-xs uppercase tracking-wide text-text-secondary">站点标题</label>
            <input type="text" value={settings.site_title} onChange={(e) => setSettings({ ...settings, site_title: e.target.value })} className="min-h-10 w-full min-w-0 rounded-md border border-border bg-bg-soft px-3 py-2.5 text-sm text-text outline-none focus:border-accent focus:bg-white" />
          </div>
          <div>
            <label className="mb-1.5 block font-mono text-xs uppercase tracking-wide text-text-secondary">每页文章数</label>
            <input type="number" min={1} max={50} value={settings.posts_per_page} onChange={(e) => setSettings({ ...settings, posts_per_page: parseInt(e.target.value) || 10 })} className="min-h-10 w-full min-w-0 rounded-md border border-border bg-bg-soft px-3 py-2.5 text-sm text-text outline-none focus:border-accent focus:bg-white" />
          </div>
        </div>
        <div className="mt-4">
          <label className="mb-1.5 block font-mono text-xs uppercase tracking-wide text-text-secondary">站点描述</label>
          <textarea value={settings.site_description} onChange={(e) => setSettings({ ...settings, site_description: e.target.value })} rows={3} className="min-h-10 w-full min-w-0 rounded-md border border-border bg-bg-soft px-3 py-2.5 text-sm text-text outline-none focus:border-accent focus:bg-white" />
        </div>
        <div className="mt-4">
          <label className="mb-1.5 block font-mono text-xs uppercase tracking-wide text-text-secondary">站点 Logo URL</label>
          <input type="text" value={settings.site_logo} onChange={(e) => setSettings({ ...settings, site_logo: e.target.value })} placeholder="https://..." className="min-h-10 w-full min-w-0 rounded-md border border-border bg-bg-soft px-3 py-2.5 font-mono text-sm text-text outline-none focus:border-accent focus:bg-white" />
          {settings.site_logo && <img src={settings.site_logo} alt="Logo 预览" className="mt-3 h-16 w-16 rounded-md border border-border object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Toggle checked={settings.enable_comments} onChange={(checked) => setSettings({ ...settings, enable_comments: checked })} label="启用评论" description="关闭后访客无法继续提交新评论。" />
        <Toggle checked={settings.comment_moderation} onChange={(checked) => setSettings({ ...settings, comment_moderation: checked })} label="评论审核" description="开启后新评论进入待审核队列，通过后才公开展示。" />
      </section>

      <section className="card max-w-full overflow-hidden rounded-md p-4 shadow-xs sm:p-5">
        <div className="mb-4 flex flex-col items-start justify-between gap-3 border-b border-border pb-3 sm:flex-row sm:gap-4">
          <div>
            <h2 className="break-words text-sm font-black text-text [overflow-wrap:anywhere]">访问干扰</h2>
            <p className="mt-1 break-words text-xs leading-5 text-text-secondary [overflow-wrap:anywhere]">这只是前端干扰层，用来减少随手 F12、右键、查看源码等操作；真正的安全仍依赖 HTTPS、PocketBase 权限、服务端限流和密钥不出服务端。</p>
          </div>
          <span className="shrink-0 rounded-md border border-warning/25 bg-warning/10 px-2.5 py-1 font-mono text-[10px] uppercase text-warning">可选</span>
        </div>
        <Toggle
          checked={settings.debug_protection_enabled}
          onChange={(checked) => setSettings({ ...settings, debug_protection_enabled: checked })}
          label="启用调试干扰"
          description="拦截 F12、Ctrl+Shift+I/J/C、Ctrl+U、右键菜单，并在页面显示轻量提示。懂技术的人仍可绕过。"
        />
      </section>

      <div className="flex justify-end">
        <button onClick={saveSettings} disabled={saving} className="btn-primary min-h-10 w-full rounded-md text-xs disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto">
          {saving ? '保存中...' : saved ? '已保存' : '保存设置'}
        </button>
      </div>
    </motion.div>
  );
}
