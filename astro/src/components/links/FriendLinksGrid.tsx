import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { getPocketBase } from '../../lib/pocketbase';
import { trackLinkClick } from '../../lib/track';
import { fadeUp, staggerContainer } from '../../lib/motion';
import type { FriendLink } from '../../types/pocketbase';

function isSafeLinkUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** 友链卡片网格：头像/首字母 + 名称 + 简介 + 域名；点击上报后新标签打开 */
export default function FriendLinksGrid() {
  const [links, setLinks] = useState<FriendLink[] | null>(null);

  useEffect(() => {
    const pb = getPocketBase();
    pb.collection('friend_links')
      .getList<FriendLink>(1, 50, { sort: 'sort_order,-created' })
      .then((r) => setLinks(r.items.filter((i) => i.status === 'show' && isSafeLinkUrl(i.url))))
      .catch(() => setLinks([]));
  }, []);

  if (links === null) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="skeleton h-28 rounded-xl" />
        ))}
      </div>
    );
  }

  if (links.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        暂无友链，欢迎通过下方邮箱申请互换。
      </div>
    );
  }

  return (
    <motion.div variants={staggerContainer(0.06)} initial="hidden" animate="visible" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {links.map((link) => (
        <motion.a
          key={link.id}
          variants={fadeUp}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => trackLinkClick(link.url)}
          whileHover={{ y: -4 }}
          whileTap={{ scale: 0.98 }}
          className="group flex items-start gap-3 rounded-xl border border-zinc-200 bg-white p-4 no-underline shadow-xl shadow-zinc-900/[0.04] transition-colors hover:border-teal-500/50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-teal-400/50"
        >
          {link.avatar ? (
            <img src={link.avatar} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
          ) : (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-sm font-bold text-white dark:bg-zinc-100 dark:text-zinc-950">
              {link.name.charAt(0)}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold text-zinc-950 transition-colors group-hover:text-teal-600 dark:text-zinc-50 dark:group-hover:text-teal-400">
              {link.name}
            </span>
            {link.description && (
              <span className="mt-0.5 block truncate text-xs text-zinc-500 dark:text-zinc-400">{link.description}</span>
            )}
            <span className="mt-1 block truncate font-mono text-[11px] text-zinc-400 dark:text-zinc-500">{hostname(link.url)}</span>
          </span>
        </motion.a>
      ))}
    </motion.div>
  );
}
