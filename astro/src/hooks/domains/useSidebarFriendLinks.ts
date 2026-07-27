import { useState, useEffect } from 'react';
import { friendLinkService } from '../../lib/services/friendLinkService';
import type { FriendLink } from '../../types/pocketbase';

function isSafeLinkUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * 侧边栏友链 Hook - 只获取可见的友链
 */
export function useSidebarFriendLinks(limit: number = 20) {
  const [links, setLinks] = useState<FriendLink[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    friendLinkService.getList(1, limit, { sort: 'sort_order,-created' })
      .then(r => setLinks(r.items.filter(i => i.status === 'show' && isSafeLinkUrl(i.url))))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [limit]);

  return { links, loading };
}
