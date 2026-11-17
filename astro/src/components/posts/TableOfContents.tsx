import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import useBreakpoint from '../../hooks/useBreakpoint';

interface Heading {
  id: string;
  text: string;
  level: number; // 2 or 3
}

interface TableOfContentsProps {
  headings: Heading[];
}

/**
 * 桌面指示条高度：优先取当前行实测 offsetHeight（标题换行时行会高于 44px），
 * 取不到时退回 `.min-h-11`（2.75rem / 44px）作为默认值。
 */
const ACTIVE_MARK_FALLBACK = 44;

export default function TableOfContents({ headings }: TableOfContentsProps) {
  const { isMobile } = useBreakpoint();
  const prefersReducedMotion = useReducedMotion();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeTop, setActiveTop] = useState(0);
  const [activeHeight, setActiveHeight] = useState(ACTIVE_MARK_FALLBACK);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  // IntersectionObserver: track which heading is in viewport
  useEffect(() => {
    if (headings.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Track the last heading that entered from the top as active
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        });
      },
      {
        rootMargin: '-80px 0px -60% 0px',
        threshold: 0,
      }
    );

    headings.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [headings]);

  // Calculate the top position of the active heading link in the nav
  const updateActiveTop = useCallback(() => {
    if (!navRef.current || !activeId) return;
    const linkEl = navRef.current.querySelector<HTMLElement>(
      `[data-heading-id="${activeId}"]`
    );
    if (linkEl) {
      setActiveTop(linkEl.offsetTop);
      // 标题换行时行高会超过 min-h-11，用实测高度让指示条覆盖整行。
      setActiveHeight(linkEl.offsetHeight || ACTIVE_MARK_FALLBACK);
    }
  }, [activeId]);

  useEffect(() => {
    updateActiveTop();
  }, [updateActiveTop]);

  // Scroll to heading on click
  const scrollToHeading = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
      if (isMobile) setMobileOpen(false);
    }
  }, [isMobile]);

  if (headings.length === 0) return null;

  // Render a single heading link item (mobile 下拉与桌面侧栏共用)
  const renderHeading = (heading: Heading) => {
    const isActive = activeId === heading.id;
    return (
      <a
        key={heading.id}
        data-heading-id={heading.id}
        href={`#${heading.id}`}
        onClick={(e) => {
          e.preventDefault();
          scrollToHeading(heading.id);
        }}
        className={`
          flex min-h-11 cursor-pointer items-center py-1.5 text-[13px] leading-snug no-underline transition-colors duration-200
          ${heading.level === 3 ? 'pl-7' : 'pl-3'}
          ${
            isActive
              ? 'font-semibold text-[var(--sf-accent-ink)]'
              : 'text-[var(--sf-ink-3)] hover:text-[var(--sf-ink)]'
          }
        `}
      >
        {heading.text}
      </a>
    );
  };

  // Mobile: collapsible dropdown
  if (isMobile) {
    return (
      <div className="mb-4">
        <button
          onClick={() => setMobileOpen((prev) => !prev)}
          className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-[4px] border border-[var(--sf-line)] bg-[var(--sf-surface)] px-3 font-mono text-[11px] tracking-[0.12em] text-[var(--sf-ink-2)] transition-colors duration-200 hover:border-[var(--sf-line-control)] hover:text-[var(--sf-ink)]"
          aria-expanded={mobileOpen}
          aria-controls="toc-mobile-panel"
        >
          <svg
            className="h-4 w-4 text-[var(--sf-ink-3)]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
            />
          </svg>
          目录
          <motion.span
            animate={{ rotate: mobileOpen ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            className="text-[10px] text-[var(--sf-ink-3)]"
            aria-hidden="true"
          >
            ▾
          </motion.span>
        </button>

        <AnimatePresence>
          {mobileOpen && (
            <motion.div
              id="toc-mobile-panel"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              <nav className="mt-2 rounded-[4px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-3">
                {headings.map(renderHeading)}
              </nav>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // Desktop: vertical sidebar with a hairline rail + sliding accent indicator
  return (
    <nav
      ref={navRef}
      aria-label="目录"
      className="relative w-44 shrink-0"
    >
      {/* 静态细线轨道：没有 active 时也保留结构线，而不是一条空悬的强调色 */}
      <div
        className="absolute inset-y-0 left-0 w-px bg-[var(--sf-line-soft)]"
        aria-hidden="true"
      />

      {/* Sliding active indicator */}
      {activeId && !prefersReducedMotion && (
        <motion.div
          className="absolute left-0 w-0.5 bg-[var(--sf-accent)]"
          animate={{ top: activeTop, height: activeHeight }}
          transition={{ type: 'spring', stiffness: 350, damping: 30 }}
          aria-hidden="true"
        />
      )}

      {/* Static indicator for reduced motion */}
      {activeId && prefersReducedMotion && (
        <div
          className="absolute left-0 w-0.5 bg-[var(--sf-accent)]"
          style={{ top: activeTop, height: activeHeight }}
          aria-hidden="true"
        />
      )}

      <div className="relative">
        {headings.map(renderHeading)}
      </div>
    </nav>
  );
}
