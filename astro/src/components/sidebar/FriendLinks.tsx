import React from 'react';
import { motion } from 'framer-motion';
import { SITE_CONFIG } from '../../config/site';

export default function FriendLinks() {
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.4 }} className="widget">
      <div className="widget-title">友情链接</div>
      <div className="flex flex-wrap gap-2">
        {SITE_CONFIG.friendLinks.map((link) => (
          <a key={link.name} href={link.url} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-border bg-bg-soft px-3 py-1.5 text-sm text-text-secondary transition-all hover:border-accent hover:text-accent hover:shadow-sm">
            {link.name}
          </a>
        ))}
      </div>
    </motion.div>
  );
}
