const fs = require('fs');
const path = require('path');

const astroSrc = path.join('H:', '开发', '个人博客', 'astro', 'src');
const sidebarDir = path.join(astroSrc, 'components', 'sidebar');

// ProfileCard.tsx
const profileCard = `import React from 'react';
import { motion } from 'framer-motion';
import { SITE_CONFIG } from '../../config/site';

export default function ProfileCard() {
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="widget text-center">
      <div className="relative mx-auto mb-4 h-24 w-24 overflow-hidden rounded-full border-2 border-border bg-bg-soft p-1">
        <img src={SITE_CONFIG.avatar} alt={SITE_CONFIG.author} className="h-full w-full rounded-full object-cover" />
      </div>
      <h3 className="text-lg font-bold text-text">{SITE_CONFIG.author}</h3>
      <p className="mt-1 text-xs text-text-secondary">{SITE_CONFIG.authorBio}</p>
      <div className="mt-5 flex items-center justify-center gap-6 text-xs text-text-secondary">
        {[{ label: '文章', value: '12' }, { label: '分类', value: '3' }, { label: '浏览', value: '1.2k' }].map((stat) => (
          <div key={stat.label} className="flex flex-col items-center gap-0.5">
            <span className="text-base font-bold text-text">{stat.value}</span>
            <span>{stat.label}</span>
          </div>
        ))}
      </div>
      <div className="mt-6 flex gap-2">
        <a href="/admin" className="btn-primary flex-1 text-xs">发布文章</a>
        <a href="/about" className="btn-ghost flex-1 text-xs">用户中心</a>
      </div>
    </motion.div>
  );
}
`;
fs.writeFileSync(path.join(sidebarDir, 'ProfileCard.tsx'), profileCard);

// CheckIn.tsx
const checkIn = `import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function CheckIn() {
  const [checked, setChecked] = useState(false);
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    const today = new Date().toDateString();
    const saved = localStorage.getItem('checkin');
    if (saved === today) setChecked(true);
    const savedStreak = parseInt(localStorage.getItem('checkin-streak') || '0', 10);
    setStreak(savedStreak);
  }, []);

  const handleCheckIn = () => {
    if (checked) return;
    const today = new Date().toDateString();
    const savedStreak = parseInt(localStorage.getItem('checkin-streak') || '0', 10);
    const newStreak = savedStreak + 1;
    localStorage.setItem('checkin', today);
    localStorage.setItem('checkin-streak', String(newStreak));
    setChecked(true);
    setStreak(newStreak);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }} className="widget relative overflow-hidden">
      <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-accent/5 blur-2xl"></div>
      <div className="widget-title relative">每日打卡</div>
      <div className="relative flex items-center justify-between">
        <div>
          <p className="text-3xl font-bold text-text">{streak}</p>
          <p className="text-xs text-text-secondary">连续打卡天数</p>
        </div>
        <button onClick={handleCheckIn} disabled={checked} className={\`rounded-full px-6 py-2.5 text-sm font-semibold transition-all \${checked ? 'bg-success/10 text-success' : 'bg-accent text-white hover:bg-accent-hover hover:shadow-lg hover:shadow-accent/25'}\`}>
          <AnimatePresence mode="wait">
            {checked ? (
              <motion.span key="checked" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="flex items-center gap-1">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                已打卡
              </motion.span>
            ) : (
              <motion.span key="checkin" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>立即打卡</motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>
      <p className="relative mt-3 text-xs text-text-muted">坚持打卡，记录每一天的进步。</p>
    </motion.div>
  );
}
`;
fs.writeFileSync(path.join(sidebarDir, 'CheckIn.tsx'), checkIn);

// HotArticles.tsx
const hotArticles = `import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { getPocketBase } from '../../lib/pocketbase';
import type { Post } from '../../types/pocketbase';

export default function HotArticles() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const pb = getPocketBase();
    pb.collection('posts')
      .getList<Post>(1, 5, { filter: 'status = "published"', sort: '-views', fields: 'id,title,slug,cover,views,created' })
      .then((res) => setPosts(res.items))
      .catch((err) => console.error('加载热榜失败:', err))
      .finally(() => setLoading(false));
  }, []);

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2 }} className="widget">
      <div className="widget-title">热榜文章</div>
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-bg-soft" />)}
        </div>
      ) : (
        <div className="space-y-3">
          {posts.length === 0 ? (
            <p className="text-sm text-text-secondary">暂无热门文章</p>
          ) : (
            posts.map((post, index) => (
              <a key={post.id} href={\`/posts/\${post.slug}\`} className="group flex items-start gap-3">
                <span className={\`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md text-xs font-bold \${index < 3 ? 'bg-accent text-white' : 'bg-bg-soft text-text-muted'}\`}>{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-medium text-text transition-colors group-hover:text-accent">{post.title}</p>
                  <p className="mt-0.5 text-xs text-text-muted">{post.views || 0} 人已阅读</p>
                </div>
              </a>
            ))
          )}
        </div>
      )}
    </motion.div>
  );
}
`;
fs.writeFileSync(path.join(sidebarDir, 'HotArticles.tsx'), hotArticles);

// RecentComments.tsx
const recentComments = `import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { getPocketBase } from '../../lib/pocketbase';
import type { Comment } from '../../types/pocketbase';

export default function RecentComments() {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const pb = getPocketBase();
    pb.collection('comments')
      .getList<Comment>(1, 5, { filter: 'status = "approved"', sort: '-created', fields: 'id,author_name,content,post_id,created' })
      .then((res) => setComments(res.items))
      .catch((err) => console.error('加载评论失败:', err))
      .finally(() => setLoading(false));
  }, []);

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.3 }} className="widget">
      <div className="widget-title">最近评论</div>
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-bg-soft" />)}
        </div>
      ) : (
        <div className="space-y-3">
          {comments.length === 0 ? (
            <p className="text-sm text-text-secondary">暂无评论</p>
          ) : (
            comments.map((comment) => (
              <div key={comment.id} className="flex items-start gap-3">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-bold text-accent">
                  {comment.author_name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-text">{comment.author_name}</p>
                  <p className="line-clamp-2 text-xs text-text-secondary">{comment.content}</p>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </motion.div>
  );
}
`;
fs.writeFileSync(path.join(sidebarDir, 'RecentComments.tsx'), recentComments);

// FriendLinks.tsx
const friendLinks = `import React from 'react';
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
`;
fs.writeFileSync(path.join(sidebarDir, 'FriendLinks.tsx'), friendLinks);

console.log('Updated sidebar widgets');
