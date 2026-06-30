import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { getPocketBase } from '../../lib/pocketbase';
import type { FriendLink } from '../../types/pocketbase';

export default function FriendLinks() {
  const [links, setLinks] = useState<FriendLink[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const pb = getPocketBase();
    pb.collection('friend_links').getList<FriendLink>(1, 20, { sort: 'sort_order,-created' })
      .then(r => setLinks(r.items.filter(i => i.status === 'show')))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (links.length === 0) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.4 }} className="widget">
      <div className="widget-title">友情链接</div>
      <div className="flex flex-wrap gap-2">
        {links.map((link) => (
          <a key={link.id} href={link.url} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-border bg-bg-soft px-3 py-1.5 text-sm text-text-secondary transition-all hover:border-accent hover:text-accent hover:shadow-sm">
            {link.name}
          </a>
        ))}
      </div>
    </motion.div>
  );
}
