import React, { useState, useEffect } from 'react';
import { userService } from '../../lib/services/userService';
import { useAuthStatus } from '../../hooks/useAuthStatus';
import AccountLoginPrompt from './AccountLoginPrompt';
import FormStatus from './FormStatus';

interface NotificationSettingsProps {
  onSave?: () => void;
}

export default function NotificationSettings({ onSave }: NotificationSettingsProps) {
  const { user, isLoading } = useAuthStatus();
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState({
    notify_comment_reply: true,
    notify_post_comment: true,
  });

  useEffect(() => {
    if (!user) return;
    // 加载当前偏好；未登录时保持默认值，不读取 authStore。
    setPrefs(userService.getNotificationPreferences());
  }, [user]);

  const handleSave = async () => {
    setLoading(true);
    setError(null);
    setSaved(false);

    const result = await userService.updateNotificationPreferences(prefs);

    setLoading(false);
    if (result.success) {
      setSaved(true);
      onSave?.();
      setTimeout(() => setSaved(false), 3000);
    } else {
      setError('保存失败，请稍后重试');
    }
  };

  // 会话确认中不要提前渲染“请先登录”，否则已登录用户会看到一闪而过的错误引导。
  if (isLoading) {
    return (
      <p role="status" aria-live="polite" className="py-4 text-sm leading-snug text-[var(--sf-ink-3)]">
        正在确认登录状态…
      </p>
    );
  }

  if (!user) {
    return <AccountLoginPrompt description="登录后即可管理邮件通知偏好。" />;
  }

  return (
    <section className="min-w-0">
      <h2 className="mb-4 text-sm font-medium text-[var(--sf-ink)]">邮件通知设置</h2>

      <div className="space-y-3">
        <label className="flex items-center justify-between gap-4">
          <span className="text-sm text-[var(--sf-ink-3)]">有人回复我的评论时通知我</span>
          <input
            type="checkbox"
            checked={prefs.notify_comment_reply}
            onChange={(e) => setPrefs({ ...prefs, notify_comment_reply: e.target.checked })}
            className="h-4 w-4 shrink-0 rounded-[2px] border-[var(--sf-line-control)] text-[var(--sf-accent)] focus:ring-[var(--sf-accent)]"
          />
        </label>

        <label className="flex items-center justify-between gap-4">
          <span className="text-sm text-[var(--sf-ink-3)]">我的文章收到新评论时通知我</span>
          <input
            type="checkbox"
            checked={prefs.notify_post_comment}
            onChange={(e) => setPrefs({ ...prefs, notify_post_comment: e.target.checked })}
            className="h-4 w-4 shrink-0 rounded-[2px] border-[var(--sf-line-control)] text-[var(--sf-accent)] focus:ring-[var(--sf-accent)]"
          />
        </label>
      </div>

      <FormStatus message={error} className="mt-3" />

      {saved && (
        <p role="status" aria-live="polite" className="mt-3 text-sm text-[var(--sf-success)]">
          已保存
        </p>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={loading}
        className="focus-ring mt-4 rounded-[3px] border border-[var(--sf-accent)] bg-[var(--sf-accent)] px-4 py-2 text-sm text-[var(--sf-on-accent)] transition-colors hover:border-[var(--sf-accent-ink)] hover:bg-[var(--sf-accent-ink)] disabled:opacity-50"
      >
        {loading ? '保存中...' : '保存设置'}
      </button>
    </section>
  );
}
