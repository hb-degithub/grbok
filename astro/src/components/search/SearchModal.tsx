import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import DOMPurify from 'dompurify';
import { cn } from '../../lib/utils';

interface PagefindResult {
  id: string;
  url: string;
  title: string;
  excerpt: string;
  content: string;
}

const LISTBOX_ID = 'search-listbox';

/**
 * 搜索弹窗组件
 *
 * 设计决策：
 * 1. 玻璃弹窗：glass-strong 容器 + 毛玻璃遮罩，与整站玻璃语言一致。
 * 2. 无障碍：采用 ARIA combobox 模式——input 为 combobox，结果列表为 listbox，
 *    每条结果为 option 并带 aria-selected；aria-activedescendant 跟踪键盘高亮项，
 *    屏幕阅读器可正确播报导航。空/无结果态用 aria-live 播报。
 */
export default function SearchModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PagefindResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isPagefindLoaded, setIsPagefindLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  /** 动态加载 Pagefind */
  useEffect(() => {
    const loadPagefind = async () => {
      try {
        setLoadError(false);
        if ((window as any).pagefind) {
          setIsPagefindLoaded(true);
          return;
        }
        const script = document.createElement('script');
        script.src = '/pagefind/pagefind.js';
        script.async = true;
        script.onload = () => {
          (window as any).pagefind?.init();
          setIsPagefindLoaded(true);
        };
        script.onerror = () => {
          setLoadError(true);
          setIsPagefindLoaded(false);
        };
        document.body.appendChild(script);
      } catch (err) {
        console.error('Pagefind 加载失败:', err);
        setLoadError(true);
      }
    };
    loadPagefind();
  }, []);

  /** 全局快捷键：Ctrl/Cmd+K 唤起，Esc 关闭 */
  useEffect(() => {
    const openSearch = () => setIsOpen(true);
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(true);
      }
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('blog-search-open', openSearch);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('blog-search-open', openSearch);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  /** 打开时聚焦输入框，并在窄屏锁定页面滚动 */
  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement | null;
      const originalOverflow = document.body.style.overflow;
      const originalPaddingRight = document.body.style.paddingRight;
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      document.body.style.overflow = 'hidden';
      if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
      const timer = setTimeout(() => inputRef.current?.focus(), 100);
      return () => {
        clearTimeout(timer);
        document.body.style.overflow = originalOverflow;
        document.body.style.paddingRight = originalPaddingRight;
      };
    }

    setQuery('');
    setResults([]);
    setSelectedIndex(0);
    previousActiveElement.current?.focus({ preventScroll: true });
  }, [isOpen]);

  /** 防抖搜索 */
  useEffect(() => {
    if (!query || !isPagefindLoaded) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        const pagefind = (window as any).pagefind;
        if (!pagefind) return;
        const search = await pagefind.search(query);
        const items = await Promise.all(
          search.results.slice(0, 10).map((r: any) => r.data())
        );
        setResults(items);
        setSelectedIndex(0);
      } catch (err) {
        console.error('搜索失败:', err);
      } finally {
        setIsLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, isPagefindLoaded]);

  /** 键盘导航：上下切换、回车跳转 */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (results[selectedIndex]) {
            window.location.href = results[selectedIndex].url;
            setIsOpen(false);
          }
          break;
      }
    },
    [results, selectedIndex]
  );

  /** 高亮项滚入视图 */
  useEffect(() => {
    if (resultsRef.current) {
      const selectedElement = resultsRef.current.children[selectedIndex] as HTMLElement;
      if (selectedElement) selectedElement.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const backdropVariants = { hidden: { opacity: 0 }, visible: { opacity: 1 } };
  const modalVariants = {
    hidden: { opacity: 0, scale: 0.95, y: -20 },
    visible: {
      opacity: 1,
      scale: 1,
      y: 0,
      transition: { type: 'spring', stiffness: 300, damping: 25 },
    },
    exit: { opacity: 0, scale: 0.95, y: -20, transition: { duration: 0.2 } },
  };
  const listVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
  };
  const itemVariants = {
    hidden: { opacity: 0, x: -10 },
    visible: { opacity: 1, x: 0, transition: { duration: 0.3 } },
  };

  /** 当前高亮项 id，供 aria-activedescendant 引用 */
  const activeOptionId = results[selectedIndex] ? `search-option-${selectedIndex}` : undefined;

  return (
    <>
      {/* ==================== 搜索弹窗 ==================== */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-stretch justify-center overflow-hidden p-0 sm:items-start sm:px-4 sm:py-6 md:pt-[12vh]"
            initial="hidden"
            animate="visible"
            exit="hidden"
          >
            {/* 毛玻璃遮罩 */}
            <motion.div
              variants={backdropVariants}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => setIsOpen(false)}
              aria-hidden="true"
            />

            {/* 弹窗容器 - 玻璃 */}
            <motion.div
              variants={modalVariants}
              role="dialog"
              aria-modal="true"
              aria-label="搜索文章"
              className="glass-strong relative z-10 flex h-[var(--vvh,100dvh)] max-h-[var(--vvh,100dvh)] w-full max-w-full flex-col overflow-hidden rounded-none sm:h-auto sm:max-h-[min(80vh,42rem)] sm:max-w-2xl sm:rounded-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* 搜索输入框 */}
              <div className="flex min-h-[56px] shrink-0 items-center border-b border-stone-200/60 px-3 py-2 pt-[max(env(safe-area-inset-top),0.5rem)] dark:border-stone-700/50 sm:px-4 sm:pt-2">
                <svg className="h-5 w-5 shrink-0 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
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
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="搜索文章..."
                  className="min-w-0 flex-1 bg-transparent px-2 py-3 text-[16px] leading-snug text-stone-900 placeholder-stone-400 outline-none dark:text-stone-100 sm:px-4 sm:text-base"
                />
                {isLoading && (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    className="h-5 w-5 shrink-0 rounded-full border-2 border-stone-300 border-t-stone-500"
                    aria-hidden="true"
                  />
                )}
                <button
                  onClick={() => setIsOpen(false)}
                  aria-label="关闭搜索"
                  className="focus-ring ml-1 inline-flex h-[40px] min-h-[40px] w-[40px] min-w-[40px] shrink-0 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-white/50 hover:text-stone-700 dark:hover:bg-white/5 dark:hover:text-stone-300 sm:w-auto sm:px-2 sm:py-1 sm:text-xs"
                >
                  <span className="hidden sm:inline">ESC</span>
                  <svg className="h-5 w-5 sm:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* 搜索结果 - listbox 模式 */}
              <div ref={resultsRef} id={LISTBOX_ID} role="listbox" aria-label="搜索结果" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:max-h-[60vh] sm:pb-2">
                {/* 状态播报 - 对屏幕阅读器可见 */}
                <div className="sr-only" aria-live="polite">
                  {loadError ? '搜索索引暂时不可用' : isLoading ? '正在搜索' : query && results.length === 0 ? '未找到相关结果' : results.length > 0 ? `找到 ${results.length} 条结果` : ''}
                </div>

                {loadError && (
                  <div className="break-words px-4 py-8 text-center text-sm leading-snug text-stone-500 dark:text-stone-400">搜索索引暂时不可用，请稍后再试</div>
                )}
                {!loadError && results.length === 0 && query && !isLoading && (
                  <div className="break-words px-4 py-8 text-center text-sm leading-snug text-stone-500 dark:text-stone-400">未找到相关结果</div>
                )}
                {!loadError && results.length === 0 && !query && (
                  <div className="break-words px-4 py-8 text-center text-sm leading-snug text-stone-500 dark:text-stone-400">输入关键词开始搜索</div>
                )}

                <motion.div variants={listVariants} initial="hidden" animate="visible">
                  {results.map((result, index) => (
                    <motion.a
                      key={result.id}
                      id={`search-option-${index}`}
                      variants={itemVariants}
                      role="option"
                      aria-selected={index === selectedIndex}
                      href={result.url}
                      onClick={() => setIsOpen(false)}
                      className={cn(
                        'focus-ring flex min-h-[44px] flex-col gap-1 rounded-lg px-3 py-3 transition-colors sm:px-4',
                        index === selectedIndex
                          ? 'bg-stone-100 dark:bg-stone-800/60'
                          : 'hover:bg-white/50 dark:hover:bg-white/5'
                      )}
                    >
                      <div className="break-words font-medium leading-snug text-stone-900 dark:text-white">{result.title || '无标题'}</div>
                      <div
                        className="line-clamp-2 break-words text-sm leading-snug text-stone-500 [overflow-wrap:anywhere] dark:text-stone-400"
                        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(result.excerpt) }}
                      />
                      <div className="break-all text-xs leading-snug text-stone-400">{result.url}</div>
                    </motion.a>
                  ))}
                </motion.div>
              </div>

              {/* 底部提示 */}
              <div className="hidden border-t border-stone-200/60 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] text-xs text-stone-500 dark:border-stone-700/50 dark:text-stone-400 sm:flex sm:items-center sm:pb-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span>↑↓ 导航</span>
                  <span>↵ 选择</span>
                  <span>ESC 关闭</span>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
