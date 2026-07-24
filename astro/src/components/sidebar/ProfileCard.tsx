import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { getPocketBase } from '../../lib/pocketbase';
import { SITE_CONFIG } from '../../config/site';
import CountUp from '../reactbits/CountUp';

interface Stat {
  label: string;
  value: string;
}

export default function ProfileCard() {
  const [mounted, setMounted] = useState(false);
  const [stats, setStats] = useState<Stat[]>([
    { label: '文章', value: '-' },
    { label: '标签', value: '-' },
    { label: '评论', value: '-' },
  ]);

  useEffect(() => {
    const pb = getPocketBase();
    const fetchStats = async () => {
      try {
        const [postsRes, tagsRes, commentsRes] = await Promise.all([
          pb.collection('posts').getList(1, 1, { filter: 'status = "published"' }),
          pb.collection('tags').getList(1, 1),
          pb.collection('comments').getList(1, 1, { filter: 'status = "approved"' }),
        ]);
        setStats([
          { label: '文章', value: String(postsRes.totalItems) },
          { label: '标签', value: String(tagsRes.totalItems) },
          { label: '评论', value: String(commentsRes.totalItems) },
        ]);
        setMounted(true);
      } catch (err) {
        console.error('加载统计数据失败:', err);
        setMounted(true);
      }
    };
    fetchStats();
  }, []);

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="space-y-3 text-center">
      <div className="relative mx-auto mb-4 h-24 w-24 overflow-hidden rounded-full border-2 border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-1">
        <img src={SITE_CONFIG.avatar} alt={SITE_CONFIG.author} className="h-full w-full rounded-full object-cover" />
      </div>
      <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">{SITE_CONFIG.author}</h3>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{SITE_CONFIG.authorBio}</p>
      {mounted && (
      <div className="mt-5 flex items-center justify-center gap-6 text-xs text-zinc-500 dark:text-zinc-400">
        {stats.map((stat) => (
          <div key={stat.label} className="flex flex-col items-center gap-0.5">
            <CountUp to={Number(stat.value)} duration={1.5} className="text-base font-bold text-zinc-900 dark:text-zinc-50" />
            <span>{stat.label}</span>
          </div>
        ))}
      </div>
      )}
      <div className="mt-6 flex gap-2">
        <a href="/login" className="btn-primary flex-1 text-xs">发布文章</a>
        <a href="/about" className="btn-ghost flex-1 text-xs">用户中心</a>
      </div>
    </motion.div>
  );
}

