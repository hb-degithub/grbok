import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { sanitizeHtml } from '../../lib/security';
import { cn } from '../../lib/utils';
import useBreakpoint from '../../hooks/useBreakpoint';

interface SearchResult {
  type: 'post' | 'tag';
  id: string;
  title: string;
  url: string;
  excerpt: string;
  score?: number;
  published_at?: string;
}

const LISTBOX_ID = 'search-listbox';

/** 从 URL 提取可读的路径片段作为面包屑 */
function urlToBreadcrumb(url: string): string {
  try {
    const path = new URL(url, 'http://x').pathname;
    return path.replace(/^\//, '').replace(/\/$/, '').split('/').filter(Boolean).join(' › ');
  } catch {
    return url;
  }
}

function SearchSkeleton() {
  return (
    <div className="flex flex-col gap-1 px-2 py-1" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-2 rounded-xl px-3 py-3 sm:px-4" style={{ opacity: 1 - i * 0.25 }}>
          <div className="skeleton h-4 w-2/5" />
          <div className="skeleton h-3 w-full" />
          <div className="skeleton h-3 w-3/4" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ icon, title, hint }: { icon: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400 dark:bg-zinc-800/80 dark:text-zinc-500">
        {icon}
      </div>
      <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">{title}</p>
      {hint && <p className="max-w-xs text-xs leading-relaxed text-zinc-400 dark:text-zinc-500">{hint}</p>}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 px-1.5 font-mono text-[10px] font-medium text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
      {children}
    </kbd>
  );
}

export default function SearchModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const { isMobile } = useBreakpoint();
  const [isLandscapePhone, setIsLandscapePhone] = useState(false);

  useEffect(() => {
    const checkLandscape = () => {
      setIsLandscapePhone(isMobile && window.innerHeight < 520);
    };
    checkLandscape();
    window.addEventListener('resize', checkLandscape, { passive: true });
    return () => window.removeEventListener('resize', checkLandscape);
  }, [isMobile]);

  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const openSearch = () => setIsOpen(true);
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsOpen(true);
      }
      if (event.key === 'Escape') setIsOpen(false);
    };

    window.addEventListener('blog-search-open', openSearch);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('blog-search-open', openSearch);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
      previousActiveElement.current?.focus({ preventScroll: true });
      return;
    }

    previousActiveElement.current = document.activeElement as HTMLElement | null;
    const originalOverflow = document.body.style.overflow;
    const originalPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;

    const timer = window.setTimeout(() => inputRef.current?.focus(), 100);
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = originalOverflow;
      document.body.style.paddingRight = originalPaddingRight;
    };
  }, [isOpen]);

  // 搜索竞态防护：请求序号比对，丢弃过期响应
  const searchSeqRef = useRef(0);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const timer = window.setTimeout(async () => {
      const seq = ++searchSeqRef.current;
      setIsLoading(true);
      setLoadError(false);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=10`);
        if (!response.ok) throw new Error('Search failed');
        const data = await response.json();
        if (seq !== searchSeqRef.current) return; // 已有更新的请求，丢弃过期结果
        setResults(data.results || []);
        setSelectedIndex(0);
      } catch (error) {
        if (seq === searchSeqRef.current) {
          console.error('搜索失败:', error);
          setLoadError(true);
        }
      } finally {
        if (seq === searchSeqRef.current) setIsLoading(false);
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    // 按 role="option" 查询选项节点，避免 sr-only 等辅助元素导致索引错位
    const el = resultsRef.current?.querySelectorAll('[role="option"]')[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, results]);

  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setSelectedIndex((value) => Math.min(value + 1, results.length - 1));
          break;
        case 'ArrowUp':
          event.preventDefault();
          setSelectedIndex((value) => Math.max(value - 1, 0));
          break;
        case 'Enter':
          event.preventDefault();
          if (results[selectedIndex]) {
            window.location.href = results[selectedIndex].url;
            setIsOpen(false);
          }
          break;
      }
    },
    [results, selectedIndex]
  );

  const activeOptionId = results[selectedIndex] ? `search-option-${selectedIndex}` : undefined;
  const statusText = loadError
    ? '搜索索引暂时不可用'
    : isLoading
      ? '正在搜索'
      : query && results.length === 0
        ? '未找到相关结果'
        : results.length > 0
          ? `找到 ${results.length} 条结果`
          : '';

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[90] flex items-stretch justify-center overflow-hidden p-0 sm:items-start sm:px-4 sm:py-6 md:pt-[12vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="absolute inset-0 bg-zinc-950/45 backdrop-blur-[6px]"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="搜索文章"
            initial={{ opacity: 0, scale: 0.97, y: -12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -12 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="glass-strong relative z-10 flex h-[var(--vvh,100dvh)] max-h-[100dvh] w-full max-w-full flex-col overflow-hidden rounded-none sm:h-auto sm:max-h-[min(80dvh,42rem)] sm:max-w-2xl sm:rounded-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            {/* 输入区 */}
            <div className="flex min-h-[60px] shrink-0 items-center gap-1 border-b border-zinc-200/70 px-4 py-2 pt-[max(env(safe-area-inset-top),0.5rem)] dark:border-zinc-700/60 sm:pt-2">
              <svg className="h-[18px] w-[18px] shrink-0 text-zinc-400 dark:text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                aria-expanded={results.length > 0}
                aria-controls={LISTBOX_ID}
                aria-activedescendant={activeOptionId}
                aria-autocomplete="list"
                aria-label="搜索文章"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="搜索文章…"
                className="min-w-0 flex-1 bg-transparent px-3 py-3 text-[16px] leading-snug text-zinc-900 placeholder-zinc-400 outline-none dark:text-zinc-100 dark:placeholder-zinc-500 sm:text-[15px]"
              />
              {isLoading && (
                <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-zinc-200 border-t-teal-500 dark:border-zinc-700 dark:border-t-teal-400" aria-hidden="true" />
              )}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="关闭搜索"
                className="focus-ring ml-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-white/5 dark:hover:text-zinc-300 sm:h-7 sm:w-auto sm:px-2"
              >
                <Kbd><span className="hidden sm:inline">esc</span></Kbd>
                <svg className="h-5 w-5 sm:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* 结果区 */}
            <div
              ref={resultsRef}
              id={LISTBOX_ID}
              role="listbox"
              aria-label="搜索结果"
              className={cn(
                'min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:max-h-[60vh] sm:pb-2',
                isLandscapePhone && 'max-h-[60dvh]'
              )}
            >
              <div className="sr-only" aria-live="polite">{statusText}</div>

              {loadError && (
                <EmptyState
                  icon={
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0 3.75h.008v.008H12v-.008zM12 21a9 9 0 100-18 9 9 0 000 18z" />
                    </svg>
                  }
                  title="搜索索引暂时不可用"
                  hint="索引文件可能尚未生成，请先执行构建后再试。"
                />
              )}

              {!loadError && isLoading && query && <SearchSkeleton />}

              {!loadError && !isLoading && results.length === 0 && query && (
                <EmptyState
                  icon={
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  }
                  title={`没有找到与「${query}」相关的内容`}
                  hint="试试更短的关键词，或检查拼写。"
                />
              )}

              {!loadError && results.length === 0 && !query && (
                <EmptyState
                  icon={
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897l12.682-12.68z" />
                    </svg>
                  }
                  title="输入关键词开始搜索"
                  hint="支持搜索文章标题与正文内容。"
                />
              )}

              {!isLoading &&
                results.map((result, index) => (
                  <a
                    key={result.id}
                    id={`search-option-${index}`}
                    role="option"
                    aria-selected={index === selectedIndex}
                    href={result.url}
                    onMouseEnter={() => setSelectedIndex(index)}
                    onClick={() => setIsOpen(false)}
                    className={cn(
                      'focus-ring group flex min-h-11 flex-col gap-1 rounded-xl px-3 py-3 transition-colors duration-150 sm:px-4',
                      index === selectedIndex
                        ? 'bg-teal-500/[0.08] dark:bg-teal-400/[0.1]'
                        : 'hover:bg-zinc-100/80 dark:hover:bg-white/[0.04]'
                    )}
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span
                        className={cn(
                          'break-words text-[15px] font-medium leading-snug transition-colors',
                          index === selectedIndex
                            ? 'text-teal-700 dark:text-teal-300'
                            : 'text-zinc-900 dark:text-zinc-100'
                        )}
                      >
                        {result.title || '无标题'}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] leading-snug text-zinc-400 dark:text-zinc-500">
                        {urlToBreadcrumb(result.url)}
                      </span>
                    </span>
                    <span
                      className="line-clamp-2 break-words text-[13px] leading-relaxed text-zinc-500 [overflow-wrap:anywhere] dark:text-zinc-400 [&_mark]:rounded-sm [&_mark]:bg-teal-500/15 [&_mark]:px-0.5 [&_mark]:text-teal-700 dark:[&_mark]:bg-teal-400/20 dark:[&_mark]:text-teal-300"
                      dangerouslySetInnerHTML={{ __html: sanitizeHtml(result.excerpt || '') }}
                    />
                  </a>
                ))}
            </div>

            {/* 底部快捷键栏 */}
            <div className="hidden shrink-0 items-center justify-between border-t border-zinc-200/70 px-4 py-2.5 text-xs text-zinc-400 dark:border-zinc-700/60 dark:text-zinc-500 sm:flex">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1.5">
                  <Kbd>↑</Kbd>
                  <Kbd>↓</Kbd>
                  <span className="ml-0.5">导航</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <Kbd>↵</Kbd>
                  <span className="ml-0.5">打开</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <Kbd>esc</Kbd>
                  <span className="ml-0.5">关闭</span>
                </span>
              </div>
              {results.length > 0 && (
                <span className="tabular-nums">{results.length} 条结果</span>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
