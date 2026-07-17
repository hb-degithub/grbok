import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { fadeUp } from '../../lib/motion';

interface FriendLinkStats {
  range: string;
  top: Array<{ target: string; clicks: number }>;
}

const PB_URL = import.meta.env.PUBLIC_POCKETBASE_URL || '';

const MEDALS = ['bg-amber-400', 'bg-zinc-300', 'bg-amber-700'];

function isSafeLinkUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * 热门友链点击排行：按契约拉 GET /api/friend-link-stats。
 * 接口未就绪（404/网络错误/空数据）时显示「排行数据积累中」空态，不报错。
 */
export default function FriendLinkLeaderboard() {
  const [stats, setStats] = useState<FriendLinkStats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!PB_URL) {
      setFailed(true);
      return;
    }
    fetch(`${PB_URL}/api/friend-link-stats`)
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
      .then((json: FriendLinkStats) => {
        if (!json || !Array.isArray(json.top)) {
          setFailed(true);
          return;
        }
        // 排行数据源自客户端上报，渲染前按协议白名单过滤（与网格一致）
        const safeTop = json.top.filter((item) => isSafeLinkUrl(item.target));
        if (safeTop.length === 0) {
          setFailed(true);
          return;
        }
        setStats({ ...json, top: safeTop });
      })
      .catch(() => setFailed(true));
  }, []);

  return (
    <motion.section variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-40px' }} className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-black tracking-tight text-zinc-950 dark:text-zinc-50">热门友链</h2>
      <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">近 30 天点击排行</p>
      {failed || !stats ? (
        <p className="py-8 text-center text-sm text-zinc-400 dark:text-zinc-500">排行数据积累中，敬请期待。</p>
      ) : (
        <ol className="mt-4 space-y-2 text-sm">
          {stats.top.map((item, i) => (
            <li key={item.target} className="flex items-center gap-3">
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${MEDALS[i] || 'bg-zinc-500'}`}>
                {i + 1}
              </span>
              <a
                href={item.target}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate text-zinc-700 no-underline hover:text-teal-600 dark:text-zinc-300 dark:hover:text-teal-400"
              >
                {hostname(item.target)}
              </a>
              <span className="shrink-0 font-mono text-xs text-zinc-500 dark:text-zinc-400">{item.clicks} 次</span>
            </li>
          ))}
        </ol>
      )}
    </motion.section>
  );
}
