import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { getPocketBase } from '../../lib/pocketbase';

interface SiteSettings {
  site_title: string; site_description: string; site_logo: string;
  posts_per_page: number; enable_comments: boolean; comment_moderation: boolean;
}
function setSettingValue(s: SiteSettings, key: keyof SiteSettings, value: string) {
  const current = s[key];
  if (typeof current === 'boolean') { (s as unknown as Record<string, unknown>)[key] = value === 'true' || value === true; }
  else if (typeof current === 'number') { const n = Number(value); (s as unknown as Record<string, unknown>)[key] = Number.isNaN(n) ? current : n; }
  else { (s as unknown as Record<string, unknown>)[key] = value; }
}

const defaults: SiteSettings = { site_title: 'My Blog', site_description: '', site_logo: '', posts_per_page: 10, enable_comments: true, comment_moderation: true };

export default function SettingsForm() {
  const [settings, setSettings] = useState<SiteSettings>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function load() {
      const pb = getPocketBase();
      try {
        const result = await pb.collection('settings').getFullList();
        const s = { ...defaults };
        result.forEach((item: { id: string; key: string; value: string; description: string; created: string; updated: string }) => {
          const key = item.key as keyof SiteSettings;
          if (key in s) setSettingValue(s, key, item.value);
        });
        setSettings(s);
      } catch (err) { console.error('Failed to load settings:', err); }
      finally { setLoading(false); }
    }
    load();
  }, []);

  const saveSettings = async () => {
    setSaving(true);
    const pb = getPocketBase();
    try {
      for (const [key, value] of Object.entries(settings)) {
        try {
          const existing = await pb.collection('settings').getFirstListItem('key = "' + key + '"');
          await pb.collection('settings').update(existing.id, { value: String(value) });
        } catch { await pb.collection('settings').create({ key, value: String(value), description: '' }); }
      }
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch (err) { console.error('Failed to save:', err); alert('Failed to save settings.'); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="space-y-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-bg-soft" />)}</div>;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card rounded-2xl p-6 sm:p-8 space-y-6">
      <div className="grid gap-6 sm:grid-cols-2">
        <div><label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">Site Title</label>
          <input type="text" value={settings.site_title} onChange={(e) => setSettings({ ...settings, site_title: e.target.value })} className="w-full rounded-lg border border-border bg-bg-soft px-4 py-2.5 text-sm text-text outline-none focus:border-accent" /></div>
        <div><label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">Posts Per Page</label>
          <input type="number" min={1} max={50} value={settings.posts_per_page} onChange={(e) => setSettings({ ...settings, posts_per_page: parseInt(e.target.value) || 10 })} className="w-full rounded-lg border border-border bg-bg-soft px-4 py-2.5 text-sm text-text outline-none focus:border-accent" /></div>
      </div>
      <div><label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">Site Description</label>
        <textarea value={settings.site_description} onChange={(e) => setSettings({ ...settings, site_description: e.target.value })} rows={3} className="w-full rounded-lg border border-border bg-bg-soft px-4 py-2.5 text-sm text-text outline-none focus:border-accent" /></div>
      <div><label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-text-secondary">Site Logo URL</label>
        <input type="text" value={settings.site_logo} onChange={(e) => setSettings({ ...settings, site_logo: e.target.value })} placeholder="https://..." className="w-full rounded-lg border border-border bg-bg-soft px-4 py-2.5 font-mono text-sm text-text outline-none focus:border-accent" />
        {settings.site_logo && <img src={settings.site_logo} alt="Logo preview" className="mt-3 h-16 w-16 rounded-lg border border-border object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}</div>
      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" checked={settings.enable_comments} onChange={(e) => setSettings({ ...settings, enable_comments: e.target.checked })} className="accent-cyan" /><span className="text-sm text-text">Enable Comments</span></label>
        <label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" checked={settings.comment_moderation} onChange={(e) => setSettings({ ...settings, comment_moderation: e.target.checked })} className="accent-cyan" /><span className="text-sm text-text">Comment Moderation</span></label>
      </div>
      <button onClick={saveSettings} disabled={saving} className="btn-primary text-xs">{saving ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}</button>
    </motion.div>
  );
}
