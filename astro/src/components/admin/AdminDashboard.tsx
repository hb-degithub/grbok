import React from 'react';
import { motion } from 'framer-motion';
import { useAdminDashboard } from '../../hooks/domains/useAdminDashboard';
import StatsCard from './StatsCard';
import type { AdminRole } from '../../hooks/useAdminAuth';

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

/* 后台设计语言（见 docs/superpowers/specs/2026-11-17-sci-fi-site-wide-design.md）：
   表面色 + 冷灰细线，圆角 3px（徽标 2px），状态只用语义色（成功 emerald、警告 amber、危险 --sf-danger）。 */
const PANEL = 'min-w-0 overflow-hidden rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)]';
const PANEL_HEAD =
  'flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[var(--sf-line)] px-3 py-2';
const HAIRLINE = 'border-b border-[var(--sf-line-soft)] last:border-b-0';
const CHIP =
  'inline-flex items-center rounded-[2px] border px-1.5 py-0.5 font-mono text-[10px] leading-none tracking-[0.08em]';

const TONE_CHIP: Record<ActionItem['tone'], string> = {
  neutral: 'border-[var(--sf-line)] text-[var(--sf-ink-3)]',
  warning: 'border-amber-600/45 text-amber-700 dark:border-amber-400/45 dark:text-amber-300',
  success: 'border-emerald-600/45 text-emerald-700 dark:border-emerald-400/45 dark:text-emerald-300',
};

function statusTone(tone: ActionItem['tone']) {
  return TONE_CHIP[tone];
}

/** 面板标题条：序号 + 标题 + 细线 + 提示，四个区块共用同一结构。 */
function Section({
  index,
  title,
  hint,
  hintClassName,
  as = 'h2',
  children,
  bodyClassName,
}: {
  index: string;
  title: string;
  hint?: string;
  hintClassName?: string;
  as?: 'h2' | 'h3';
  children: React.ReactNode;
  bodyClassName?: string;
}) {
  const titleClassName = 'text-[13px] font-semibold tracking-tight text-[var(--sf-ink)]';
  return (
    <section className={PANEL}>
      <div className={PANEL_HEAD}>
        <span className="font-mono text-[10px] tracking-[0.2em] text-[var(--sf-ink-3)]">{index}</span>
        {as === 'h3' ? (
          <h3 className={titleClassName}>{title}</h3>
        ) : (
          <h2 className={titleClassName}>{title}</h2>
        )}
        <span className="ml-1 h-px min-w-4 flex-1 bg-[var(--sf-line)]" aria-hidden="true" />
        {hint && (
          <span className={`font-mono text-[10px] tracking-[0.12em] ${hintClassName ?? 'text-[var(--sf-ink-3)]'}`}>{hint}</span>
        )}
      </div>
      <div className={bodyClassName ?? 'px-3 py-2.5'}>{children}</div>
    </section>
  );
}

export default function AdminDashboard() {
  const {
    stats,
    loading,
    recentPosts,
    recentComments,
    role,
    hasPermission,
    user,
    publishRate,
    reviewRate,
  } = useAdminDashboard();

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
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)]" />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="h-56 animate-pulse rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)]" />
        <div className="h-56 animate-pulse rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)]" />
      </div>
    </div>
  );

  if (!stats) return <div className="rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-4 text-sm text-[var(--sf-ink-2)]">统计数据暂不可用，请检查后台 API 连接后重试。</div>;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
      <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className={PANEL}>
          <div className="flex flex-wrap items-start justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--sf-ink-3)]">TODAY BRIEF</p>
              <h2 className="mt-1 break-words text-lg font-black leading-tight text-[var(--sf-ink)]">{user?.name || 'HB'}，后台状态已同步</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--sf-ink-2)]">发布比例 {publishRate}%，评论处理率 {reviewRate}%。优先看草稿和待审核评论，其他配置保持稳定。</p>
            </div>
            <span className="rounded-[2px] border border-[var(--sf-line)] bg-[var(--sf-canvas)] px-2.5 py-1 font-mono text-[11px] tabular-nums text-[var(--sf-ink-2)]">{currentTime}</span>
          </div>
        </div>
        <div className={PANEL}>
          <div className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--sf-ink-3)]">CURRENT ROLE</p>
              <p className="mt-1 break-words text-sm font-semibold text-[var(--sf-ink)]">{role ? roleLabels[role] : '已验证会话'}</p>
            </div>
            <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--sf-ink-3)]">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600 dark:bg-emerald-400" aria-hidden="true" />
              ONLINE
            </span>
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
        <Section index="01" title="下一步操作" hint={`${visibleActions.length} 项`} bodyClassName="px-0 py-0">
          <p className="px-3 pt-2.5 text-[11px] leading-relaxed text-[var(--sf-ink-3)]">根据当前权限和数据状态排序。</p>
          <div className="mt-2 border-t border-[var(--sf-line)]">
            {visibleActions.map((item, index) => (
              <a key={item.href} href={item.href} className={`group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--sf-canvas)] ${HAIRLINE}`}>
                <span className="font-mono text-[10px] tabular-nums tracking-[0.16em] text-[var(--sf-ink-3)]">{String(index + 1).padStart(2, '0')}</span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-[var(--sf-ink)]">{item.label}</div>
                  <div className="mt-0.5 truncate text-xs text-[var(--sf-ink-3)]">{item.detail}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`${CHIP} ${statusTone(item.tone)}`}>{item.status}</span>
                  <svg className="h-4 w-4 shrink-0 text-[var(--sf-ink-3)] transition-colors group-hover:text-[var(--sf-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 5l7 7-7 7" /></svg>
                </div>
              </a>
            ))}
          </div>
        </Section>

        <Section index="02" title="运行信号" hint="正常" hintClassName="text-emerald-700 dark:text-emerald-300" bodyClassName="px-3 py-3">
          <p className="mb-2.5 text-[11px] leading-relaxed text-[var(--sf-ink-3)]">内容状态与权限状态。</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
            <div className="rounded-[2px] border border-[var(--sf-line-soft)] bg-[var(--sf-canvas)] px-3 py-2.5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-[var(--sf-ink-2)]">发布比例</span>
                <span className="font-mono text-xs tabular-nums text-[var(--sf-ink)]">{publishRate}%</span>
              </div>
              <div className="mt-2 h-[2px] overflow-hidden bg-[var(--sf-line)]">
                <div className="h-full bg-[var(--sf-accent)]" style={{ width: `${publishRate}%` }} />
              </div>
            </div>
            <div className="rounded-[2px] border border-[var(--sf-line-soft)] bg-[var(--sf-canvas)] px-3 py-2.5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-[var(--sf-ink-2)]">评论处理率</span>
                <span className="font-mono text-xs tabular-nums text-[var(--sf-ink)]">{reviewRate}%</span>
              </div>
              <div className="mt-2 h-[2px] overflow-hidden bg-[var(--sf-line)]">
                <div className="h-full bg-emerald-600 dark:bg-emerald-400" style={{ width: `${reviewRate}%` }} />
              </div>
            </div>
          </div>
        </Section>
      </div>

      <section className="grid gap-4 lg:grid-cols-2">
        <Section index="03" title="最近文章" as="h3" hint={`${recentPosts.length} 条`} bodyClassName="px-0 py-0">
          {recentPosts.length === 0 ? (
            <p className="px-3 py-3 text-xs text-[var(--sf-ink-3)]">暂无文章</p>
          ) : (
            <div>
              {recentPosts.map(post => (
                <div key={post.id} className={`flex items-center justify-between gap-3 px-3 py-2.5 ${HAIRLINE}`}>
                  <div className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--sf-ink)]">{post.title}</div>
                  <span className={`shrink-0 ${CHIP} ${post.status === 'published' ? 'border-emerald-600/45 text-emerald-700 dark:border-emerald-400/45 dark:text-emerald-300' : post.status === 'draft' ? 'border-amber-600/45 text-amber-700 dark:border-amber-400/45 dark:text-amber-300' : 'border-[var(--sf-line)] text-[var(--sf-ink-3)]'}`}>{post.status}</span>
                </div>
              ))}
            </div>
          )}
        </Section>
        <Section index="04" title="最近评论" as="h3" hint={`${recentComments.length} 条`} bodyClassName="px-0 py-0">
          {recentComments.length === 0 ? (
            <p className="px-3 py-3 text-xs text-[var(--sf-ink-3)]">暂无评论</p>
          ) : (
            <div>
              {recentComments.map(c => (
                <div key={c.id} className={`px-3 py-2.5 ${HAIRLINE}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold text-[var(--sf-ink)]">{c.author_name}</span>
                    <span className={`shrink-0 ${CHIP} ${c.status === 'approved' ? 'border-emerald-600/45 text-emerald-700 dark:border-emerald-400/45 dark:text-emerald-300' : c.status === 'pending' ? 'border-amber-600/45 text-amber-700 dark:border-amber-400/45 dark:text-amber-300' : 'border-[var(--sf-line)] text-[var(--sf-ink-3)]'}`}>{c.status}</span>
                  </div>
                  <p className="mt-1 truncate text-xs text-[var(--sf-ink-3)]">{c.content}</p>
                </div>
              ))}
            </div>
          )}
        </Section>
      </section>
    </motion.div>
  );
}
