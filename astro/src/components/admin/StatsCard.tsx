import React from 'react';
import { motion } from 'framer-motion';

interface Props { label: string; value: number | string; icon: string; color: 'cyan' | 'amber' | 'emerald' | 'red'; trend?: string; }

const colorMap = {
  cyan: { bg: 'bg-accent/10', text: 'text-accent', glow: 'shadow-[0_0_20px_rgba(34,211,238,0.1)]' },
  amber: { bg: 'bg-warning/10', text: 'text-warning', glow: 'shadow-[0_0_20px_rgba(251,191,36,0.1)]' },
  emerald: { bg: 'bg-success/10', text: 'text-success', glow: 'shadow-[0_0_20px_rgba(52,211,153,0.1)]' },
  red: { bg: 'bg-danger/10', text: 'text-danger', glow: 'shadow-[0_0_20px_rgba(239,68,68,0.1)]' },
};

export default function StatsCard({ label, value, icon, color, trend }: Props) {
  const c = colorMap[color];
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className={'card rounded-xl p-5 ' + c.glow}>
      <div className="flex items-start justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted">{label}</p>
          <p className={'mt-2 font-display text-3xl font-black ' + c.text}>{value}</p>
          {trend && <p className="mt-1 text-xs text-text-secondary">{trend}</p>}
        </div>
        <div className={'flex h-10 w-10 items-center justify-center rounded-lg ' + c.bg}>
          <svg className={'h-5 w-5 ' + c.text} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={icon} /></svg>
        </div>
      </div>
    </motion.div>
  );
}
