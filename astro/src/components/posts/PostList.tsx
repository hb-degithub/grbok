import React, { useCallback, useEffect, useState } from 'react';
import { motion, MotionConfig } from 'framer-motion';
import { usePosts } from '../../hooks/usePocketBase';
import PostCard from './PostCard';

interface PostListProps {
  /** 首屏页码，通常由页面从 URL 的 ?page= 读出后传入。 */
  initialPage?: number;
  perPage?: number;
  tagSlug?: string;
  /**
   * 是否把当前页码同步到 URL 的 ?page=。
   *
   * 阅读页（/posts、/tags/[slug]）开启，让刷新/分享/返回都能回到同一页；
   * 首页等"嵌入列表"保持关闭，避免翻页改写首页 URL 却无人读取。
   */
  syncPageQuery?: boolean;
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

/** 页码只接受有限正整数；非法值（0 / NaN / 负数）收敛到第 1 页。 */
function normalizePage(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
  return Math.max(1, Math.trunc(value));
}

/**
 * 用 history.replaceState 把页码写回 ?page=。
 *
 * 用 replace 而不是 push：翻页是同一个列表视图的状态变化，不应在浏览器历史里
 * 生成一串中间页；用户按返回时仍回到进入列表前的页面。非浏览器或受限环境
 * （沙箱 iframe、被禁用 history）下静默降级，列表功能不受影响。
 */
function writePageQuery(page: number): void {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  try {
    const url = new URL(window.location.href);
    if (page > 1) url.searchParams.set('page', String(page));
    else url.searchParams.delete('page');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // URL 改写失败不能影响翻页本身。
  }
}

/** 骨架行：与最终行的列结构一致，避免加载完成时的布局跳动。 */
function SkeletonRow({ index }: { index: number }) {
  return (
    <motion.li
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: index * 0.03, duration: 0.3 }}
      className="flex items-start gap-x-4 border-b border-[var(--sf-line-soft)] py-6 sm:gap-x-6"
      aria-hidden="true"
    >
      <div className="h-3 w-8 shrink-0 skeleton" />
      <div className="min-w-0 flex-1 space-y-2.5">
        <div className="h-4 w-3/4 skeleton" />
        <div className="h-3 w-full skeleton" />
        <div className="h-3 w-1/2 skeleton" />
      </div>
    </motion.li>
  );
}

/**
 * 文章列表 —— 编号行索引。
 *
 * 数据流与三态语义：
 *   - 数据仍来自 usePosts(currentPage, perPage, tagSlug)，不在本地造数据；
 *   - 加载中 role="status" / 失败 role="alert" + 重试 / 空列表提示都保留；
 *   - 重试调用 usePosts 的 retry()，真实重新取数并清除错误，不再整页 reload；
 *   - 分页按钮保留 aria-label / aria-current 与 44px 触控高度。
 *
 * 页码状态：首屏由页面从 ?page= 读出传给 initialPage；岛内翻页用
 * history.replaceState 写回 ?page=（仅 syncPageQuery 开启时）。URL 页码越界
 * （例如收藏了 /posts?page=99 而实际只有 5 页）时收敛到最后一页，避免把
 * 「页码不存在」显示成「暂无文章」。
 *
 * 视觉：一条顶部细线 + 每行底细线，序号跨分页连续（第 2 页从 perPage + 1
 * 开始），可直接当索引用；颜色一律走共享令牌 var(--sf-*)，深浅主题自动切换。
 *
 * 动效：整棵子树包在 MotionConfig reducedMotion="user" 里，淡入 / 分页切换 /
 * 翻页按钮 whileTap 的接口保留，系统开启「减少动态效果」时统一降级。
 * 列表用 ol 承载序号语义，并显式保留 role="list"（部分浏览器会移除 ol 的列表角色）。
 */
export default function PostList({ initialPage = 1, perPage = 6, tagSlug, syncPageQuery = false }: PostListProps) {
  const [currentPage, setCurrentPage] = useState(() => normalizePage(initialPage));
  const { posts, loading, error, totalPages, retry } = usePosts(currentPage, perPage, tagSlug);

  const requestPage = useCallback(
    (page: number) => {
      setCurrentPage(page);
      if (syncPageQuery) writePageQuery(page);
    },
    [syncPageQuery],
  );

  // 越界页码收敛：只在一次成功取数之后判断，loading / error 期间不来回跳。
  useEffect(() => {
    if (loading || error) return;
    const lastPage = Math.max(1, totalPages);
    if (currentPage > lastPage) requestPage(lastPage);
  }, [currentPage, error, loading, requestPage, totalPages]);

  let content: React.ReactNode;

  if (loading) {
    content = (
      <div role="status" aria-live="polite" aria-label="加载中">
        <ul className="list-none border-t border-[var(--sf-line)] p-0">
          {Array.from({ length: perPage }).map((_, i) => (
            <SkeletonRow key={i} index={i} />
          ))}
        </ul>
        <span className="sr-only">正在加载文章...</span>
      </div>
    );
  } else if (error) {
    content = (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        role="alert"
        className="flex flex-col items-start gap-4 border-y border-[var(--sf-line)] px-1 py-12"
      >
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--sf-ink-3)]">ERR / 取数失败</p>
        <p className="text-sm text-[var(--sf-ink-2)]">加载失败，请稍后重试</p>
        <button
          type="button"
          onClick={retry}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[3px] border border-[var(--sf-line-control)] bg-[var(--sf-surface)] px-4 font-mono text-xs uppercase tracking-[0.14em] text-[var(--sf-ink)] transition-colors duration-200 hover:border-[var(--sf-accent)] hover:text-[var(--sf-accent-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)]"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          重试
        </button>
      </motion.div>
    );
  } else if (posts.length === 0) {
    content = (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="border-y border-[var(--sf-line)] px-1 py-16 text-center"
      >
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--sf-ink-3)]">EMPTY / 0</p>
        <p className="mt-3 text-sm text-[var(--sf-ink-2)]">暂无文章</p>
      </motion.div>
    );
  } else {
    content = (
      <div>
        {/* 翻页只做一次短暂的淡入：不做 exit 动画，避免旧列表占用退出时间才换内容。 */}
        <motion.div
          key={currentPage}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }}
        >
          {/* role="list" 显式保留列表语义，避免 list-style:none 被部分浏览器移除角色 */}
          <ol role="list" className="list-none border-t border-[var(--sf-line)] p-0">
            {posts.map((post, index) => (
              <li key={post.id}>
                <PostCard
                  post={post}
                  index={index}
                  ordinal={(currentPage - 1) * perPage + index + 1}
                />
              </li>
            ))}
          </ol>
        </motion.div>

        {totalPages > 1 && (
          <motion.nav
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            aria-label="文章分页"
            className="mt-8 flex flex-wrap items-center gap-2"
          >
            <span className="mr-auto font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--sf-ink-3)]">
              PAGE / {currentPage} / {totalPages}
            </span>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <motion.button
                key={page}
                type="button"
                onClick={() => requestPage(page)}
                whileTap={{ scale: 0.96 }}
                aria-current={currentPage === page ? 'page' : undefined}
                aria-label={`第 ${page} 页`}
                className={cn(
                  'flex h-11 min-w-11 items-center justify-center rounded-[3px] border px-3 font-mono text-sm transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)] sm:h-9 sm:min-w-9',
                  currentPage === page
                    ? // 强调色底 + 画布色字：浅色主题下对 #0b6d76、暗色主题下对 #3fa8b2 都满足正文对比度
                      'border-[var(--sf-accent)] bg-[var(--sf-accent)] text-[var(--sf-canvas)]'
                    : 'border-[var(--sf-line)] bg-transparent text-[var(--sf-ink-2)] hover:border-[var(--sf-line-strong)] hover:text-[var(--sf-ink)]',
                )}
              >
                {page}
              </motion.button>
            ))}
          </motion.nav>
        )}
      </div>
    );
  }

  return <MotionConfig reducedMotion="user">{content}</MotionConfig>;
}
