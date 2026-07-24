import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { getPocketBase } from '../../lib/pocketbase';
import type { FriendLink } from '../../types/pocketbase';

function isSafeLinkUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export default function FriendLinks() {
  const [links, setLinks] = useState<FriendLink[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const pb = getPocketBase();
    pb.collection('friend_links').getList<FriendLink>(1, 20, { sort: 'sort_order,-created' })
      .then(r => setLinks(r.items.filter(i => i.status === 'show' && isSafeLinkUrl(i.url))))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="space-y-3">
      <div className="text-sm font-black tracking-tight text-zinc-950 dark:text-zinc-50">友情链接</div>
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-8 w-20 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
        ))}
      </div>
    </motion.div>
  );
  if (links.length === 0) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.4 }} className="space-y-3">
      <div className="text-sm font-black tracking-tight text-zinc-950 dark:text-zinc-50">友情链接</div>
      <div className="flex flex-wrap gap-2">
        {links.map((link) => (
          <a key={link.id} href={link.url} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-4 py-2.5 sm:px-3 sm:py-1.5 text-sm text-zinc-500 dark:text-zinc-400 transition-all hover:border-teal-600 dark:hover:border-teal-400 hover:text-teal-600 dark:hover:text-teal-400 hover:shadow-sm">
            {link.name}
          </a>
        ))}
      </div>
    </motion.div>
  );
}
