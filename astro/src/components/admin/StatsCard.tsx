import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';

interface Props {
  label: string;
  value: number | string;
  icon: string;
  color: 'cyan' | 'amber' | 'emerald' | 'red';
  trend?: string;
  progress?: number;
}

const colorMap = {
  cyan: { bg: 'bg-accent/10', text: 'text-accent', border: 'border-accent/25', bar: 'bg-accent' },
  amber: { bg: 'bg-warning/10', text: 'text-warning', border: 'border-warning/25', bar: 'bg-warning' },
  emerald: { bg: 'bg-success/10', text: 'text-success', border: 'border-success/25', bar: 'bg-success' },
  red: { bg: 'bg-danger/10', text: 'text-danger', border: 'border-danger/25', bar: 'bg-danger' },
};

export default function StatsCard({ label, value, icon, color, trend, progress }: Props) {
  const c = colorMap[color];
  const safeProgress = typeof progress === 'number' ? Math.max(0, Math.min(100, progress)) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('card min-w-0 overflow-hidden rounded-md border bg-white p-3 shadow-xs transition-colors hover:border-border-hover sm:p-4', c.border)}
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-md border', c.bg, c.border)}>
          <svg className={cn('h-[18px] w-[18px]', c.text)} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d={icon} /></svg>
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
            <p className="min-w-0 flex-1 basis-24 break-words font-mono text-[10px] uppercase tracking-wide text-muted [overflow-wrap:anywhere]">{label}</p>
            <p className={cn('max-w-full break-words text-right font-display text-2xl font-black leading-none [overflow-wrap:anywhere]', c.text)}>{value}</p>
          </div>
          {trend && <p className="mt-1 break-words text-xs text-text-secondary [overflow-wrap:anywhere]">{trend}</p>}
          {safeProgress !== null && (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg-soft">
              <div className={cn('h-full rounded-full', c.bar)} style={{ width: `${safeProgress}%` }} />
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
