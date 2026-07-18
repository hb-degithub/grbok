import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { sanitizeHtml } from '../../lib/security';
import { cn } from '../../lib/utils';
import useBreakpoint from '../../hooks/useBreakpoint';

interface PagefindResult {
  id: string;
  url: string;
  title?: string;
  excerpt?: string;
}

const LISTBOX_ID = 'search-listbox';

export default function SearchModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PagefindResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isPagefindLoaded, setIsPagefindLoaded] = useState(false);
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
    const loadPagefind = async () => {
      try {
        setLoadError(false);
        if ((window as any).pagefind) {
          setIsPagefindLoaded(true);
          return;
        }

        // pagefind.js 是 ESM（含 import.meta），classic <script> 加载会抛语法错误；
        // 用动态 import 加载，挂到 window.pagefind 供搜索逻辑复用。
        // 变量形式的路径避免 Vite 构建期静态解析（索引文件由 pagefind CLI 在构建后生成）。
        const pagefindPath = '/pagefind/pagefind.js';
        const pagefind = await import(/* @vite-ignore */ pagefindPath);
        await pagefind.init?.();
        (window as any).pagefind = pagefind;
        setIsPagefindLoaded(true);
      } catch (error) {
        console.error('Pagefind 加载失败:', error);
        setLoadError(true);
        setIsPagefindLoaded(false);
      }
    };

    loadPagefind();
  }, []);

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

  useEffect(() => {
    if (!query.trim() || !isPagefindLoaded) {
      setResults([]);
      return;
    }

    const timer = window.setTimeout(async () => {
      setIsLoading(true);
      try {
        const pagefind = (window as any).pagefind;
        if (!pagefind) return;
        const search = await pagefind.search(query);
        const items = await Promise.all(search.results.slice(0, 10).map((result: any) => result.data()));
        setResults(items);
        setSelectedIndex(0);
      } catch (error) {
        console.error('搜索失败:', error);
      } finally {
        setIsLoading(false);
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [query, isPagefindLoaded]);

  useEffect(() => {
    const selectedElement = resultsRef.current?.children[selectedIndex] as HTMLElement | undefined;
    selectedElement?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

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
          <motion.div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setIsOpen(false)} aria-hidden="true" />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="搜索文章"
            initial={{ opacity: 0, scale: 0.96, y: -16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -16 }}
            transition={{ duration: 0.2 }}
            className="glass-strong relative z-10 flex h-[var(--vvh,100dvh)] max-h-[100dvh] w-full max-w-full flex-col overflow-hidden rounded-none sm:h-auto sm:max-h-[min(80dvh,42rem)] sm:max-w-2xl sm:rounded-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex min-h-[56px] shrink-0 items-center border-b border-zinc-200/60 px-3 py-2 pt-[max(env(safe-area-inset-top),0.5rem)] dark:border-zinc-700/50 sm:px-4 sm:pt-2">
              <svg className="h-5 w-5 shrink-0 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
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
                placeholder="搜索文章..."
                className="min-w-0 flex-1 bg-transparent px-2 py-3 text-[16px] leading-snug text-zinc-900 placeholder-zinc-400 outline-none dark:text-zinc-100 sm:px-4 sm:text-base"
              />
              {isLoading && <span className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-500" aria-hidden="true" />}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="关闭搜索"
                className="focus-ring ml-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/50 hover:text-zinc-700 dark:hover:bg-white/5 dark:hover:text-zinc-300 sm:w-auto sm:px-2 sm:text-xs"
              >
                <span className="hidden sm:inline">ESC</span>
                <svg className="h-5 w-5 sm:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div ref={resultsRef} id={LISTBOX_ID} role="listbox" aria-label="搜索结果" className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:max-h-[60vh] sm:pb-2', isLandscapePhone && 'max-h-[60dvh]')}>
              <div className="sr-only" aria-live="polite">{statusText}</div>

              {loadError && <div className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">搜索索引暂时不可用，请稍后再试。</div>}
              {!loadError && results.length === 0 && query && !isLoading && <div className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">未找到相关结果。</div>}
              {!loadError && results.length === 0 && !query && <div className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">输入关键词开始搜索。</div>}

              {results.map((result, index) => (
                <a
                  key={result.id}
                  id={`search-option-${index}`}
                  role="option"
                  aria-selected={index === selectedIndex}
                  href={result.url}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => setIsOpen(false)}
                  className={cn(
                    'focus-ring flex min-h-11 flex-col gap-1 rounded-lg px-3 py-3 transition-colors sm:px-4',
                    index === selectedIndex ? 'bg-zinc-100 dark:bg-zinc-800/60' : 'hover:bg-white/50 dark:hover:bg-white/5'
                  )}
                >
                  <span className="break-words font-medium leading-snug text-zinc-900 dark:text-white">{result.title || '无标题'}</span>
                  <span
                    className="line-clamp-2 break-words text-sm leading-snug text-zinc-500 [overflow-wrap:anywhere] dark:text-zinc-400"
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(result.excerpt || '') }}
                  />
                  <span className="break-all text-xs leading-snug text-zinc-400">{result.url}</span>
                </a>
              ))}
            </div>

            <div className="hidden border-t border-zinc-200/60 px-4 py-3 text-xs text-zinc-500 dark:border-zinc-700/50 dark:text-zinc-400 sm:flex sm:items-center">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>上下键导航</span>
                <span>Enter 选择</span>
                <span>ESC 关闭</span>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
