import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import DOMPurify from 'dompurify';
import { cn } from '../../lib/utils';

/**
 * Pagefind 搜索结果类型
 */
interface PagefindResult {
  id: string;
  url: string;
  title: string;
  excerpt: string;
  content: string;
}

/**
 * 搜索弹窗组件
 * 实现全局搜索功能，支持快捷键唤起和键盘导航
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

  /**
   * 初始化 Pagefind
   * 通过 script 标签加载 Pagefind JS（运行时加载）
   */
  useEffect(() => {
    const loadPagefind = async () => {
      try {
        // 检查是否已加载
        if ((window as any).pagefind) {
          setIsPagefindLoaded(true);
          return;
        }

        // 动态创建 script 标签加载 Pagefind
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

  /**
   * 全局快捷键监听
   * Ctrl + K (Windows/Linux) 或 Cmd + K (Mac) 唤起搜索
   */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 唤起搜索：Ctrl/Cmd + K
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(true);
      }

      // 关闭搜索：Esc
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  /**
   * 打开时聚焦输入框
   */
  useEffect(() => {
    if (isOpen) {
      // 延迟聚焦，等待动画完成
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  /**
   * 防抖搜索
   * 用户输入 300ms 后执行搜索
   */
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

  /**
   * 键盘导航
   * 上下方向键切换高亮项，回车跳转
   */
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

  /**
   * 滚动高亮项到视图
   */
  useEffect(() => {
    if (resultsRef.current) {
      const selectedElement = resultsRef.current.children[selectedIndex] as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  /**
   * 动画配置
   */
  const backdropVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
  };

  const modalVariants = {
    hidden: {
      opacity: 0,
      scale: 0.95,
      y: -20,
    },
    visible: {
      opacity: 1,
      scale: 1,
      y: 0,
      transition: {
        type: 'spring',
        stiffness: 300,
        damping: 25,
      },
    },
    exit: {
      opacity: 0,
      scale: 0.95,
      y: -20,
      transition: {
        duration: 0.2,
      },
    },
  };

  const listVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.05,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, x: -10 },
    visible: {
      opacity: 1,
      x: 0,
      transition: { duration: 0.3 },
    },
  };

  return (
    <>
      {/* ==================== 搜索触发按钮 ==================== */}
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-500 transition-all hover:border-gray-400 hover:text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:hover:border-gray-500 dark:hover:text-gray-300"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <span className="hidden sm:inline">搜索...</span>
        <kbd className="hidden rounded border border-gray-300 px-1.5 py-0.5 text-xs font-semibold text-gray-500 sm:inline dark:border-gray-600">
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
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={() => setIsOpen(false)}
            />

            {/* 弹窗容器 */}
            <motion.div
              variants={modalVariants}
              className="relative z-10 mx-4 w-full max-w-2xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900"
              onClick={(e) => e.stopPropagation()}
            >
              {/* 搜索输入框 */}
              <div className="flex items-center border-b border-gray-200 px-4 dark:border-gray-700">
                <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="搜索文章..."
                  className="flex-1 bg-transparent px-4 py-4 text-gray-900 placeholder-gray-400 outline-none dark:text-gray-100"
                />
                {isLoading && (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    className="h-5 w-5 rounded-full border-2 border-gray-300 border-t-blue-500"
                  />
                )}
                <button
                  onClick={() => setIsOpen(false)}
                  className="ml-2 rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  ESC
                </button>
              </div>

              {/* 搜索结果 */}
              <div ref={resultsRef} className="max-h-[60vh] overflow-y-auto p-2">
                {results.length === 0 && query && !isLoading && (
                  <div className="py-8 text-center text-gray-500">
                    未找到相关结果
                  </div>
                )}

                {results.length === 0 && !query && (
                  <div className="py-8 text-center text-gray-500">
                    输入关键词开始搜索
                  </div>
                )}

                <motion.div variants={listVariants} initial="hidden" animate="visible">
                  {results.map((result, index) => (
                    <motion.a
                      key={result.id}
                      variants={itemVariants}
                      href={result.url}
                      onClick={() => setIsOpen(false)}
                      className={cn(
                        'flex flex-col gap-1 rounded-lg px-4 py-3 transition-colors',
                        index === selectedIndex
                          ? 'bg-blue-50 dark:bg-blue-900/30'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                      )}
                    >
                      <div className="font-medium text-gray-900 dark:text-white">
                        {result.title || '无标题'}
                      </div>
                      <div
                        className="line-clamp-2 text-sm text-gray-500 dark:text-gray-400"
                        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(result.excerpt) }}
                      />
                      <div className="text-xs text-gray-400">
                        {result.url}
                      </div>
                    </motion.a>
                  ))}
                </motion.div>
              </div>

              {/* 底部提示 */}
              <div className="border-t border-gray-200 px-4 py-3 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
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
