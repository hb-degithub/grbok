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

export default function TableOfContents({ headings }: TableOfContentsProps) {
  const { isMobile } = useBreakpoint();
  const prefersReducedMotion = useReducedMotion();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeTop, setActiveTop] = useState(0);
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

  // Render a single heading link item
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
          block cursor-pointer py-1.5 text-[13px] leading-snug transition-colors duration-200
          ${heading.level === 3 ? 'pl-4' : ''}
          ${
            isActive
              ? 'text-teal-600 font-semibold dark:text-teal-400'
              : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
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
          className="focus-ring inline-flex items-center gap-1.5 rounded-lg bg-white/60 px-3 py-2 text-sm font-medium text-zinc-700 backdrop-blur-sm transition-colors hover:bg-white/80 dark:bg-zinc-800/60 dark:text-zinc-300 dark:hover:bg-zinc-800/80"
          aria-expanded={mobileOpen}
          aria-controls="toc-mobile-panel"
        >
          <svg
            className="h-4 w-4 text-zinc-400 dark:text-zinc-500"
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
            className="text-xs"
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
              <nav className="mt-2 rounded-lg border border-zinc-200/60 bg-white/70 p-3 backdrop-blur-sm dark:border-zinc-700/50 dark:bg-zinc-800/70">
                {headings.map(renderHeading)}
              </nav>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // Desktop: vertical sidebar with sliding indicator
  return (
    <nav
      ref={navRef}
      aria-label="目录"
      className="relative w-44 shrink-0"
    >
      {/* Sliding active indicator */}
      {activeId && !prefersReducedMotion && (
        <motion.div
          className="absolute left-0 w-0.5 rounded-full bg-teal-500 dark:bg-teal-400"
          animate={{ top: activeTop, height: 20 }}
          transition={{ type: 'spring', stiffness: 350, damping: 30 }}
          aria-hidden="true"
        />
      )}

      {/* Static indicator for reduced motion */}
      {activeId && prefersReducedMotion && (
        <div
          className="absolute left-0 w-0.5 rounded-full bg-teal-500 dark:bg-teal-400"
          style={{ top: activeTop, height: 20 }}
          aria-hidden="true"
        />
      )}

      <div className="relative pl-3">
        {headings.map(renderHeading)}
      </div>
    </nav>
  );
}
