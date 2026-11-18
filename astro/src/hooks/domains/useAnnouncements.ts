import { useState, useEffect, useCallback } from 'react';
import { announcementService } from '../../lib/services/announcementService';
import type { Announcement } from '../../types/pocketbase';

/**
 * 公告 Hook - 前台获取最新公告
 */
export function useAnnouncements(limit: number = 3) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAnnouncements(await announcementService.getAll(100));
    } catch {
      // 前台降级：失败静默
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveAnnouncement = useCallback(async (data: Partial<Announcement>): Promise<{ success: boolean; error?: string }> => {
    setSaving(true);
    try {
      await announcementService.save(data);
      await load();
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : '保存失败' };
    } finally {
      setSaving(false);
    }
  }, [load]);

  const deleteAnnouncement = useCallback(async (id: string): Promise<boolean> => {
    setSaving(true);
    try {
      await announcementService.remove(id);
      await load();
      return true;
    } catch {
      return false;
    } finally {
      setSaving(false);
    }
  }, [load]);

  const toggleEnabled = useCallback(async (item: Announcement): Promise<boolean> => {
    setSaving(true);
    try {
      await announcementService.toggleEnabled(item.id, !item.enabled);
      await load();
      return true;
    } catch {
      return false;
    } finally {
      setSaving(false);
    }
  }, [load]);

  return { announcements, loading, saving, saveAnnouncement, deleteAnnouncement, toggleEnabled };
}

/** 前台轻量 Hook：仅最新启用中的公告 */
export function useLatestAnnouncements(limit: number = 3, initial?: Announcement[] | null) {
  // SSR 已经预取过公告时用它做初始值：既避免重复请求，也避免「水合后才有公告」
  // 造成的整页位移（容器 :has(.announcement-bar) 的间距会从 0 跳到 80px）。
  const seeded = Array.isArray(initial) && initial.length > 0;
  const [announcements, setAnnouncements] = useState<Announcement[]>(seeded ? initial : []);
  const [loading, setLoading] = useState(!seeded);

  useEffect(() => {
    if (seeded) return;
    announcementService.getLatest(limit)
      .then(setAnnouncements)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [limit, seeded]);

  return { announcements, loading };
}
