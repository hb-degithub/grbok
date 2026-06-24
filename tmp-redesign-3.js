const fs = require('fs');
const path = require('path');

const astroSrc = path.join('H:', '开发', '个人博客', 'astro', 'src');

// PostCard.tsx - horizontal layout
const postCard = `import React from 'react';
import { motion } from 'framer-motion';
import type { Post } from '../../types/pocketbase';

interface PostCardProps {
  post: Post;
  index?: number;
  layout?: 'horizontal' | 'vertical';
}

export default function PostCard({ post, index = 0, layout = 'horizontal' }: PostCardProps) {
  const formattedDate = post.published_at
    ? new Date(post.published_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
    : new Date(post.created).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  const readingTime = Math.max(1, Math.ceil((post.content?.length || 0) / 300));

  if (layout === 'vertical') {
    return (
      <motion.article
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: index * 0.06, ease: [0.16, 1, 0.3, 1] }}
        className="card group overflow-hidden"
      >
        <a href={\`/posts/\${post.slug}\`} className="block">
          <div className="aspect-[16/10] overflow-hidden bg-bg-soft">
            {post.cover ? (
              <img
                src={post.cover}
                alt={post.title}
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                loading="lazy"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-text-muted">
                <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
            )}
          </div>
          <div className="p-4">
            <div className="mb-2 flex items-center gap-2 text-xs text-text-muted">
              <span>{formattedDate}</span>
              <span>·</span>
              <span>{readingTime} 分钟阅读</span>
            </div>
            <h3 className="mb-2 line-clamp-2 text-base font-semibold text-text transition-colors group-hover:text-accent">
              {post.title}
            </h3>
            {post.excerpt && (
              <p className="line-clamp-2 text-sm text-text-secondary">{post.excerpt}</p>
            )}
          </div>
        </a>
      </motion.article>
    );
  }

  return (
    <motion.article
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.06, ease: [0.16, 1, 0.3, 1] }}
      className="card group overflow-hidden"
    >
      <a href={\`/posts/\${post.slug}\`} className="flex flex-col sm:flex-row">
        <div className="sm:w-48 md:w-56 flex-shrink-0 overflow-hidden bg-bg-soft">
          {post.cover ? (
            <img
              src={post.cover}
              alt={post.title}
              className="h-48 w-full object-cover transition-transform duration-500 group-hover:scale-105 sm:h-full"
              loading="lazy"
            />
          ) : (
            <div className="flex h-48 w-full items-center justify-center bg-bg-soft text-text-muted sm:h-full">
              <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          )}
        </div>
        <div className="flex flex-1 flex-col justify-center p-5">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-text-muted">
            <span className="tag">默认分类</span>
            <span>·</span>
            <span>{formattedDate}</span>
            <span>·</span>
            <span>{readingTime} 分钟阅读</span>
          </div>
          <h3 className="mb-2 text-lg font-semibold text-text transition-colors group-hover:text-accent sm:text-xl">
            {post.title}
          </h3>
          {post.excerpt && (
            <p className="mb-3 line-clamp-2 text-sm text-text-secondary">{post.excerpt}</p>
          )}
          <div className="mt-auto flex items-center gap-4 text-xs text-text-muted">
            <span className="flex items-center gap-1">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              {post.views || 0}
            </span>
            <span className="flex items-center gap-1">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              0
            </span>
          </div>
        </div>
      </a>
    </motion.article>
  );
}
`;
fs.writeFileSync(path.join(astroSrc, 'components', 'posts', 'PostCard.tsx'), postCard);
console.log('Created PostCard.tsx');

// Create sidebar components directory
const sidebarDir = path.join(astroSrc, 'components', 'sidebar');
if (!fs.existsSync(sidebarDir)) fs.mkdirSync(sidebarDir, { recursive: true });

// ProfileCard.tsx
const profileCard = `import React from 'react';
import { SITE_CONFIG } from '../../config/site';

export default function ProfileCard() {
  return (
    <div className="widget text-center">
      <div className="relative mx-auto mb-3 h-20 w-20 overflow-hidden rounded-full border-2 border-border bg-bg-soft">
        <img
          src={SITE_CONFIG.avatar}
          alt={SITE_CONFIG.author}
          className="h-full w-full object-cover"
        />
      </div>
      <h3 className="text-lg font-semibold text-text">{SITE_CONFIG.author}</h3>
      <p className="mt-1 text-xs text-text-muted">{SITE_CONFIG.authorBio}</p>
      <div className="mt-3 flex items-center justify-center gap-4 text-xs text-text-secondary">
        <span className="flex flex-col items-center">
          <strong className="text-base font-semibold text-text">12</strong>
          文章
        </span>
        <span className="flex flex-col items-center">
          <strong className="text-base font-semibold text-text">3</strong>
          分类
        </span>
        <span className="flex flex-col items-center">
          <strong className="text-base font-semibold text-text">1.2k</strong>
          浏览
        </span>
      </div>
      <div className="mt-4 flex gap-2">
        <a href="/admin" className="btn-primary flex-1 text-xs">发布文章</a>
        <a href="/about" className="btn-ghost flex-1 text-xs">用户中心</a>
      </div>
    </div>
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
    <div className="widget">
      <div className="widget-title">每日打卡</div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-2xl font-bold text-text">{streak}</p>
          <p className="text-xs text-text-secondary">连续打卡天数</p>
        </div>
        <button
          onClick={handleCheckIn}
          disabled={checked}
          className={\`rounded-full px-5 py-2 text-sm font-medium transition-all \${
            checked
              ? 'bg-success/10 text-success'
              : 'bg-accent text-white hover:bg-accent-hover'
          }\`}
        >
          <AnimatePresence mode="wait">
            {checked ? (
              <motion.span
                key="checked"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="flex items-center gap-1"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                已打卡
              </motion.span>
            ) : (
              <motion.span key="checkin" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                立即打卡
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>
      <p className="mt-3 text-xs text-text-muted">坚持打卡，记录每一天的进步。</p>
    </div>
  );
}
`;
fs.writeFileSync(path.join(sidebarDir, 'CheckIn.tsx'), checkIn);

// HotArticles.tsx
const hotArticles = `import React, { useState, useEffect } from 'react';
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

  if (loading) {
    return (
      <div className="widget">
        <div className="widget-title">热榜文章</div>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-md bg-bg-soft" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="widget">
      <div className="widget-title">热榜文章</div>
      <div className="space-y-3">
        {posts.length === 0 ? (
          <p className="text-sm text-text-secondary">暂无热门文章</p>
        ) : (
          posts.map((post, index) => (
            <a key={post.id} href={\`/posts/\${post.slug}\`} className="group flex items-start gap-3">
              <span
                className={\`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-xs font-bold \${
                  index < 3 ? 'bg-accent text-white' : 'bg-bg-soft text-text-muted'
                }\`}
              >
                {index + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="line-clamp-2 text-sm font-medium text-text transition-colors group-hover:text-accent">
                  {post.title}
                </p>
                <p className="mt-0.5 text-xs text-text-muted">{post.views || 0} 人已阅读</p>
              </div>
            </a>
          ))
        )}
      </div>
    </div>
  );
}
`;
fs.writeFileSync(path.join(sidebarDir, 'HotArticles.tsx'), hotArticles);

// RecentComments.tsx
const recentComments = `import React, { useState, useEffect } from 'react';
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

  if (loading) {
    return (
      <div className="widget">
        <div className="widget-title">最近评论</div>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-md bg-bg-soft" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="widget">
      <div className="widget-title">最近评论</div>
      <div className="space-y-3">
        {comments.length === 0 ? (
          <p className="text-sm text-text-secondary">暂无评论</p>
        ) : (
          comments.map((comment) => (
            <div key={comment.id} className="flex items-start gap-3">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-bg-soft text-xs font-bold text-text-secondary">
                {comment.author_name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-text">{comment.author_name}</p>
                <p className="line-clamp-2 text-xs text-text-secondary">{comment.content}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
`;
fs.writeFileSync(path.join(sidebarDir, 'RecentComments.tsx'), recentComments);

// FriendLinks.tsx
const friendLinks = `import React from 'react';
import { SITE_CONFIG } from '../../config/site';

export default function FriendLinks() {
  return (
    <div className="widget">
      <div className="widget-title">友情链接</div>
      <div className="flex flex-wrap gap-2">
        {SITE_CONFIG.friendLinks.map((link) => (
          <a
            key={link.name}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md bg-bg-soft px-3 py-1.5 text-sm text-text-secondary transition-colors hover:bg-accent hover:text-white"
          >
            {link.name}
          </a>
        ))}
      </div>
    </div>
  );
}
`;
fs.writeFileSync(path.join(sidebarDir, 'FriendLinks.tsx'), friendLinks);

console.log('Created sidebar components');
console.log('Step 3-5 complete');
