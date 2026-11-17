import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { fadeUp } from '../../lib/motion';

interface FriendLinkStats {
  range: string;
  top: Array<{ target: string; clicks: number }>;
}

const PB_URL = import.meta.env.PUBLIC_POCKETBASE_URL || '';

/**
 * 名次标记：单一强调色 + 冷灰梯度，取代原来的奖牌色块。
 * 1 强调色 / 2 控制线 / 3 结构线，其余弱化到软线，信息层级靠线与文字色区分。
 */
const RANK_TONES = [
  'border-[var(--sf-accent)] text-[var(--sf-accent-ink)]',
  'border-[var(--sf-line-control)] text-[var(--sf-ink-2)]',
  'border-[var(--sf-line)] text-[var(--sf-ink-2)]',
];
const RANK_TONE_DEFAULT = 'border-[var(--sf-line-soft)] text-[var(--sf-ink-3)]';

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
 * 视觉：细线表面；外链 hover 只换文字色，不放大不发光。
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
    <motion.section variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-40px' }} className="rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-5">
      <h2 className="text-sm font-semibold tracking-tight text-[var(--sf-ink)]">热门友链</h2>
      <p className="mt-1 text-xs text-[var(--sf-ink-3)]">近 30 天点击排行</p>
      {failed || !stats ? (
        <p className="py-8 text-center text-sm text-[var(--sf-ink-3)]">排行数据积累中，敬请期待。</p>
      ) : (
        <ol className="mt-4 space-y-2 text-sm">
          {stats.top.map((item, i) => (
            <li key={item.target} className="flex items-center gap-3">
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[2px] border bg-[var(--sf-canvas)] font-mono text-[10px] ${RANK_TONES[i] || RANK_TONE_DEFAULT}`}>
                {i + 1}
              </span>
              <a
                href={item.target}
                target="_blank"
                rel="noopener noreferrer"
                className="focus-ring min-w-0 flex-1 truncate text-[var(--sf-ink-2)] no-underline transition-colors hover:text-[var(--sf-accent-ink)]"
              >
                {hostname(item.target)}
              </a>
              <span className="shrink-0 font-mono text-xs text-[var(--sf-ink-3)]">{item.clicks} 次</span>
            </li>
          ))}
        </ol>
      )}
    </motion.section>
  );
}
