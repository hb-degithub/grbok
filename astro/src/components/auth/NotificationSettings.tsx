import { useState, useEffect } from 'react';
import { userService } from '../../lib/services/userService';

interface NotificationSettingsProps {
  onSave?: () => void;
}

export default function NotificationSettings({ onSave }: NotificationSettingsProps) {
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState({
    notify_comment_reply: true,
    notify_post_comment: true,
  });

  useEffect(() => {
    // 加载当前偏好
    const current = userService.getNotificationPreferences();
    setPrefs(current);
  }, []);

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

  if (!userService.isLoggedIn()) {
    return null;
  }

  return (
    <div className="rounded-lg border border-border bg-bg-soft p-4">
      <h3 className="mb-4 text-sm font-medium text-text">邮件通知设置</h3>
      
      <div className="space-y-3">
        <label className="flex items-center justify-between">
          <span className="text-sm text-text-muted">有人回复我的评论时通知我</span>
          <input
            type="checkbox"
            checked={prefs.notify_comment_reply}
            onChange={(e) => setPrefs({ ...prefs, notify_comment_reply: e.target.checked })}
            className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
          />
        </label>
        
        <label className="flex items-center justify-between">
          <span className="text-sm text-text-muted">我的文章收到新评论时通知我</span>
          <input
            type="checkbox"
            checked={prefs.notify_post_comment}
            onChange={(e) => setPrefs({ ...prefs, notify_post_comment: e.target.checked })}
            className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
          />
        </label>
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-500">{error}</p>
      )}
      
      {saved && (
        <p className="mt-3 text-sm text-green-500">已保存</p>
      )}

      <button
        onClick={handleSave}
        disabled={loading}
        className="mt-4 rounded-md bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover disabled:opacity-50"
      >
        {loading ? '保存中...' : '保存设置'}
      </button>
    </div>
  );
}
