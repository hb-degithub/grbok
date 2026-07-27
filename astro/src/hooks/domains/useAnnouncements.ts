import { useState, useEffect } from 'react';
import { announcementService } from '../../lib/services/announcementService';
import type { Announcement } from '../../types/pocketbase';

/**
 * 公告 Hook - 获取最新公告
 */
export function useAnnouncements(limit: number = 3) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    announcementService.getLatest(limit)
      .then(setAnnouncements)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [limit]);

  return { announcements, loading };
}
