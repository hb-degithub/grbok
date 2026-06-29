import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { getPocketBase } from '../../lib/pocketbase';
import { useAdminAuth, type AdminRole } from '../../hooks/useAdminAuth';
import StatsCard from './StatsCard';

interface DashboardStats {
  totalPosts: number;
  publishedPosts: number;
  draftPosts: number;
  totalComments: number;
  pendingComments: number;
  totalTags: number;
  totalUsers: number | null;
}

interface ActionItem {
  label: string;
  detail: string;
  href: string;
  requiredRole: AdminRole;
  status: string;
  tone: 'neutral' | 'warning' | 'success';
}

const roleLabels: Record<AdminRole, string> = {
  reader: '普通用户',
  author: '作者',
  admin: '管理员',
  super_admin: '超级管理员',
};

function statusTone(tone: ActionItem['tone']) {
  if (tone === 'warning') return 'border-warning/25 bg-warning/10 text-warning';
  if (tone === 'success') return 'border-success/25 bg-success/10 text-success';
  return 'border-border bg-white text-muted';
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const { hasPermission, user } = useAdminAuth();
  const role = user?.role as AdminRole | undefined;
  const canReadUsers = role === 'super_admin';

  useEffect(() => {
    async function fetchStats() {
      if (!role) return;
      const pb = getPocketBase();
      try {
        const [posts, published, drafts, comments, pending, tags, users] = await Promise.all([
          pb.collection('posts').getList(1, 1),
          pb.collection('posts').getList(1, 1, { filter: 'status = "published"' }),
          pb.collection('posts').getList(1, 1, { filter: 'status = "draft"' }),
          pb.collection('comments').getList(1, 1),
          pb.collection('comments').getList(1, 1, { filter: 'status = "pending"' }),
          pb.collection('tags').getList(1, 1),
          canReadUsers ? pb.collection('users').getList(1, 1) : Promise.resolve(null),
        ]);
        setStats({
          totalPosts: posts.totalItems,
          publishedPosts: published.totalItems,
          draftPosts: drafts.totalItems,
          totalComments: comments.totalItems,
          pendingComments: pending.totalItems,
          totalTags: tags.totalItems,
          totalUsers: users?.totalItems ?? null,
        });
      } catch (err) {
        console.error('获取统计数据失败：', err);
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, [role, canReadUsers]);

  const [recentPosts, setRecentPosts] = useState<{id:string;title:string;status:string;updated:string}[]>([]);
  const [recentComments, setRecentComments] = useState<{id:string;author_name:string;content:string;status:string;created:string}[]>([]);

  useEffect(() => {
    const pb = getPocketBase();
    pb.collection("posts").getList(1, 5, { sort: "-updated", fields: "id,title,status,updated" }).then(r => setRecentPosts(r.items)).catch(() => {});
    pb.collection("comments").getList(1, 5, { sort: "-created", fields: "id,author_name,content,status,created" }).then(r => setRecentComments(r.items)).catch(() => {});
  }, []);

  const publishRate = stats && stats.totalPosts > 0 ? Math.round((stats.publishedPosts / stats.totalPosts) * 100) : 0;
  const reviewRate = stats && stats.totalComments > 0 ? Math.round(((stats.totalComments - stats.pendingComments) / stats.totalComments) * 100) : 100;
  const currentTime = new Date().toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', month: '2-digit', day: '2-digit' });

  const actionItems: ActionItem[] = [
    { label: '继续写作', detail: stats ? `${stats.draftPosts} 篇草稿待完善` : '草稿队列', href: '/admin/posts', requiredRole: 'author', status: '内容', tone: stats?.draftPosts ? 'warning' : 'neutral' },
    { label: '审核评论', detail: stats ? `${stats.pendingComments} 条评论待处理` : '审核队列', href: '/admin/comments', requiredRole: 'admin', status: stats?.pendingComments ? '待处理' : '正常', tone: stats?.pendingComments ? 'warning' : 'success' },
    { label: '整理标签', detail: stats ? `${stats.totalTags} 个标签启用中` : '标签库', href: '/admin/tags', requiredRole: 'author', status: '分类', tone: 'neutral' },
    { label: '安全审计', detail: '检查登录、权限与防护配置', href: '/admin/security', requiredRole: 'super_admin', status: '系统', tone: 'neutral' },
  ];
  const visibleActions = actionItems.filter((item) => hasPermission(item.requiredRole));

  if (loading) return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-md border border-border bg-white" />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="h-56 animate-pulse rounded-md border border-border bg-white" />
        <div className="h-56 animate-pulse rounded-md border border-border bg-white" />
      </div>
    </div>
  );

  if (!stats) return <div className="card rounded-md p-6 text-sm text-text-secondary">统计数据暂不可用，请检查后台 API 连接后重试。</div>;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
      <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="card rounded-md border-border bg-white p-4 shadow-xs">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-wide text-muted">Today brief</p>
              <h2 className="mt-1 text-lg font-black text-text">{user?.name || 'HB'}，后台状态已同步</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-text-secondary">发布比例 {publishRate}%，评论处理率 {reviewRate}%。优先看草稿和待审核评论，其他配置保持稳定。</p>
            </div>
            <span className="rounded-md border border-border bg-bg-soft px-3 py-1.5 font-mono text-xs text-text-secondary">{currentTime}</span>
          </div>
        </div>
        <div className="card rounded-md border-border bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wide text-muted">Current role</p>
              <p className="mt-1 text-sm font-semibold text-text">{role ? roleLabels[role] : '已验证会话'}</p>
            </div>
            <span className="h-2.5 w-2.5 rounded-full bg-success shadow-[0_0_0_5px_rgba(16,185,129,0.12)]" />
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatsCard label="文章总数" value={stats.totalPosts} color="cyan" icon="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" trend={`${stats.publishedPosts} 已发布 / ${stats.draftPosts} 草稿`} progress={publishRate} />
        <StatsCard label="评论" value={stats.totalComments} color="amber" icon="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" trend={`${stats.pendingComments} 条待审核`} progress={reviewRate} />
        <StatsCard label="标签" value={stats.totalTags} color="emerald" icon="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" trend="分类已就绪" />
        <StatsCard label="用户" value={stats.totalUsers ?? '受限'} color="red" icon="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" trend={stats.totalUsers === null ? '当前角色无用户列表权限' : '用户列表可访问'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.9fr)]">
        <section className="card rounded-md p-4 shadow-xs">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-black text-text">下一步操作</h2>
              <p className="text-xs text-text-secondary">根据当前权限和数据状态排序。</p>
            </div>
          </div>
          <div className="divide-y divide-border border-y border-border">
            {visibleActions.map((item) => (
              <a key={item.href} href={item.href} className="group grid grid-cols-[1fr_auto] items-center gap-3 py-3 text-text hover:text-text">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{item.label}</div>
                  <div className="mt-0.5 truncate text-xs text-text-secondary">{item.detail}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-md border px-2 py-1 font-mono text-[10px] uppercase ${statusTone(item.tone)}`}>{item.status}</span>
                  <svg className="h-4 w-4 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-text" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 5l7 7-7 7" /></svg>
                </div>
              </a>
            ))}
          </div>
        </section>

        <section className="card rounded-md p-4 shadow-xs">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-black text-text">运行信号</h2>
              <p className="text-xs text-text-secondary">内容状态与权限状态。</p>
            </div>
            <span className="rounded-md border border-success/25 bg-success/10 px-2.5 py-1 font-mono text-[10px] uppercase text-success">正常</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
            <div className="rounded-md border border-border bg-bg-soft p-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-text">发布比例</span>
                <span className="font-mono text-xs text-text-secondary">{publishRate}%</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white">
                <div className="h-full rounded-full bg-accent" style={{ width: `${publishRate}%` }} />
              </div>
            </div>
            <div className="rounded-md border border-border bg-bg-soft p-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-text">评论处理率</span>
                <span className="font-mono text-xs text-text-secondary">{reviewRate}%</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white">
                <div className="h-full rounded-full bg-success" style={{ width: `${reviewRate}%` }} />
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Recent Activity */}
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card rounded-md p-4 shadow-xs">
          <h3 className="mb-3 text-sm font-black text-text">最近文章</h3>
          {recentPosts.length === 0 ? (
            <p className="text-xs text-text-secondary">暂无文章</p>
          ) : (
            <div className="divide-y divide-border">
              {recentPosts.map(post => (
                <div key={post.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0 flex-1 truncate text-sm font-medium text-text">{post.title}</div>
                  <span className={'shrink-0 rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase ' + (post.status === 'published' ? 'border-success/25 bg-success/10 text-success' : post.status === 'draft' ? 'border-warning/25 bg-warning/10 text-warning' : 'border-border bg-bg-soft text-text-secondary')}>{post.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card rounded-md p-4 shadow-xs">
          <h3 className="mb-3 text-sm font-black text-text">最近评论</h3>
          {recentComments.length === 0 ? (
            <p className="text-xs text-text-secondary">暂无评论</p>
          ) : (
            <div className="divide-y divide-border">
              {recentComments.map(c => (
                <div key={c.id} className="py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold text-text">{c.author_name}</span>
                    <span className={'shrink-0 rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase ' + (c.status === 'approved' ? 'border-success/25 bg-success/10 text-success' : c.status === 'pending' ? 'border-warning/25 bg-warning/10 text-warning' : 'border-border bg-bg-soft text-text-secondary')}>{c.status}</span>
                  </div>
                  <p className="mt-1 truncate text-xs text-text-secondary">{c.content}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </motion.div>
  );
}
