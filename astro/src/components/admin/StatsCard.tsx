import React from 'react';
import { motion } from 'framer-motion';

interface Props {
  label: string;
  value: number | string;
  icon: string;
  color: 'cyan' | 'amber' | 'emerald' | 'red';
  trend?: string;
  progress?: number;
}

/**
 * 统计卡：单一强调色（--sf-accent）+ 冷灰细线 + 等宽短标签。
 * color 仍作为语义参数保留（data-tone），但视觉上不再引入第二/第三强调色，
 * 以符合"浅色/暗色唯一强调色"的设计约束。
 */
export default function StatsCard({ label, value, icon, color, trend, progress }: Props) {
  const safeProgress = typeof progress === 'number' ? Math.max(0, Math.min(100, progress)) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      data-tone={color}
      className="group relative min-w-0 overflow-hidden rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-3 transition-colors hover:border-[var(--sf-line-strong)] sm:p-4"
    >
      <span className="absolute left-0 top-0 h-px w-10 bg-[var(--sf-accent)]" aria-hidden="true" />
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[2px] border border-[var(--sf-line)] bg-[var(--sf-canvas)] text-[var(--sf-accent)]">
          <svg className="h-[17px] w-[17px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={icon} /></svg>
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
            <p className="min-w-0 flex-1 basis-24 break-words font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--sf-ink-3)] [overflow-wrap:anywhere]">{label}</p>
            <p className="max-w-full break-words text-right font-display text-2xl font-black leading-none tracking-tight text-[var(--sf-ink)] tabular-nums [overflow-wrap:anywhere]">{value}</p>
          </div>
          {trend && <p className="mt-1 break-words text-xs leading-snug text-[var(--sf-ink-2)] [overflow-wrap:anywhere]">{trend}</p>}
          {safeProgress !== null && (
            <div className="mt-3 h-[2px] overflow-hidden bg-[var(--sf-line-soft)]">
              <motion.div
                className="h-full bg-[var(--sf-accent)]"
                initial={{ width: 0 }}
                animate={{ width: `${safeProgress}%` }}
                transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
              />
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
