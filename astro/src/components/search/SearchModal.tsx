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

  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  /** 动态加载 Pagefind */
  useEffect(() => {
    const loadPagefind = async () => {
      try {
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
        document.body.appendChild(script);
      } catch (err) {
        console.error('Pagefind 加载失败:', err);
      }
    };
    loadPagefind();
  }, []);

  /** 全局快捷键：Ctrl/Cmd+K 唤起，Esc 关闭 */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(true);
      }
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  /** 打开时聚焦输入框 */
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    } else {
      // 关闭时重置状态
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
    }
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
      {/* ==================== 搜索触发按钮 ==================== */}
      <button
        onClick={() => setIsOpen(true)}
        aria-label="搜索文章（快捷键 Ctrl 或 Command 加 K）"
        className="focus-ring glass-dark flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-500 transition-colors hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <span className="hidden sm:inline">搜索...</span>
        <kbd className="hidden rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-xs font-semibold text-zinc-400 sm:inline">
          ⌘K
        </kbd>
      </button>

      {/* ==================== 搜索弹窗 ==================== */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
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
              className="glass-strong relative z-10 mx-4 w-full max-w-2xl overflow-hidden rounded-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* 搜索输入框 */}
              <div className="flex items-center border-b border-zinc-200/60 px-4 dark:border-zinc-700/50">
                <svg className="h-5 w-5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
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
                  className="flex-1 bg-transparent px-4 py-4 text-zinc-900 placeholder-zinc-400 outline-none dark:text-zinc-100"
                />
                {isLoading && (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    className="h-5 w-5 rounded-full border-2 border-zinc-300 border-t-indigo-500"
                    aria-hidden="true"
                  />
                )}
                <button
                  onClick={() => setIsOpen(false)}
                  aria-label="关闭搜索"
                  className="focus-ring ml-2 rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-white/50 hover:text-zinc-700 dark:hover:bg-white/5 dark:hover:text-zinc-300"
                >
                  ESC
                </button>
              </div>

              {/* 搜索结果 - listbox 模式 */}
              <div ref={resultsRef} id={LISTBOX_ID} role="listbox" aria-label="搜索结果" className="max-h-[60vh] overflow-y-auto p-2">
                {/* 状态播报 - 对屏幕阅读器可见 */}
                <div className="sr-only" aria-live="polite">
                  {isLoading ? '正在搜索' : query && results.length === 0 ? '未找到相关结果' : results.length > 0 ? `找到 ${results.length} 条结果` : ''}
                </div>

                {results.length === 0 && query && !isLoading && (
                  <div className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">未找到相关结果</div>
                )}
                {results.length === 0 && !query && (
                  <div className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">输入关键词开始搜索</div>
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
                        'focus-ring flex flex-col gap-1 rounded-lg px-4 py-3 transition-colors',
                        index === selectedIndex
                          ? 'bg-indigo-50 dark:bg-indigo-950/40'
                          : 'hover:bg-white/50 dark:hover:bg-white/5'
                      )}
                    >
                      <div className="font-medium text-zinc-900 dark:text-white">{result.title || '无标题'}</div>
                      <div
                        className="line-clamp-2 text-sm text-zinc-500 dark:text-zinc-400"
                        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(result.excerpt) }}
                      />
                      <div className="text-xs text-zinc-400">{result.url}</div>
                    </motion.a>
                  ))}
                </motion.div>
              </div>

              {/* 底部提示 */}
              <div className="border-t border-zinc-200/60 px-4 py-3 text-xs text-zinc-500 dark:border-zinc-700/50 dark:text-zinc-400">
                <div className="flex items-center gap-4">
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
