import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const STORAGE_KEY = 'huba-checkin';
const STREAK_KEY = 'huba-checkin-streak';

export default function CheckIn() {
  const [mounted, setMounted] = useState(false);
  const [checked, setChecked] = useState(false);
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    setMounted(true);
    try {
      const today = new Date().toDateString();
      const savedDate = localStorage.getItem(STORAGE_KEY);
      const savedStreak = localStorage.getItem(STREAK_KEY);
      
      if (savedDate === today) {
        setChecked(true);
      }
      
      const parsedStreak = savedStreak ? parseInt(savedStreak, 10) : 0;
      setStreak(Number.isNaN(parsedStreak) ? 0 : parsedStreak);
    } catch (err) {
      console.error('读取打卡记录失败:', err);
    }
  }, []);

  const handleCheckIn = () => {
    if (checked) return;
    try {
      const today = new Date().toDateString();
      const savedStreak = localStorage.getItem(STREAK_KEY);
      const parsedStreak = savedStreak ? parseInt(savedStreak, 10) : 0;
      const newStreak = (Number.isNaN(parsedStreak) ? 0 : parsedStreak) + 1;
      
      localStorage.setItem(STORAGE_KEY, today);
      localStorage.setItem(STREAK_KEY, String(newStreak));
      
      setChecked(true);
      setStreak(newStreak);
    } catch (err) {
      console.error('保存打卡记录失败:', err);
    }
  };

  if (!mounted) {
    return (
      <div className="space-y-3 relative overflow-hidden">
        <div className="text-sm font-black tracking-tight text-zinc-950 dark:text-zinc-50 relative">每日打卡</div>
        <div className="h-14 animate-pulse rounded-lg bg-zinc-50 dark:bg-zinc-900" />
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }} className="space-y-3 relative overflow-hidden">
      <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-teal-500/5 blur-2xl"></div>
      <div className="text-sm font-black tracking-tight text-zinc-950 dark:text-zinc-50 relative">每日打卡</div>
      <div className="relative flex items-center justify-between">
        <div>
          <p className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">{streak}</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">连续打卡天数</p>
        </div>
        <motion.button onClick={handleCheckIn} disabled={checked} whileTap={{ scale: 0.95 }} className={`rounded-full px-6 py-2.5 text-sm font-semibold transition-all ${checked ? 'bg-emerald-500/10 text-emerald-500' : 'bg-teal-500 text-white hover:bg-teal-600 hover:shadow-lg hover:shadow-teal-500/25'}`}>
          <AnimatePresence mode="wait">
            {checked ? (
              <motion.span key="checked" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="flex items-center gap-1">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                已打卡
              </motion.span>
            ) : (
              <motion.span key="checkin" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>立即打卡</motion.span>
            )}
          </AnimatePresence>
        </motion.button>
      </div>
      <p className="relative mt-3 text-xs text-zinc-400 dark:text-zinc-500">坚持打卡，记录每一天的进步。</p>
    </motion.div>
  );
}
