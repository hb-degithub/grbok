import React, { useState, useEffect } from 'react';

/**
 * GitHub 仓库信息卡组件 —— 异步加载仓库信息，缓存兜底。
 *
 * 展示层归类：👁️ 用户可见层
 * 隔离方式：组件内 Tailwind class（不污染全局）
 * 三态规范：加载态（骨架屏）/ 错误态（降级为静态链接）/ 空状态（不渲染）
 * 缓存：localStorage 缓存 1 小时，减少 API 调用
 *
 * 用法（在 /projects 页面或文章中追加）：
 * <GitHubRepoCard owner="hb-degithub" repo="grbok" client:visible />
 *
 * 科幻简约：细线表面 + 小圆角，唯一强调色只用于 hover 描边与文字色；
 * 去掉上浮/重阴影，语言与话题改用等宽短标签，不再写死品牌十六进制色值。
 */

interface RepoData {
  name: string;
  full_name: string;
  description: string;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  language: string;
  topics: string[];
  updated_at: string;
}

interface Props {
  owner: string;
  repo: string;
  className?: string;
}

const CACHE_TTL = 60 * 60 * 1000; // 1 小时

export default function GitHubRepoCard({ owner, repo, className }: Props) {
  const [data, setData] = useState<RepoData | null>(null);
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');

  useEffect(() => {
    const cacheKey = `gh-repo:${owner}/${repo}`;
    const raw = localStorage.getItem(cacheKey);

    if (raw) {
      try {
        const cached = JSON.parse(raw);
        if (Date.now() - cached.ts < CACHE_TTL) {
          setData(cached.data);
          setStatus('loaded');
          return;
        }
      } catch (e) { console.warn('GitHub repo cache parse failed:', e); }
    }

    let cancelled = false;
    // 安全修复：GITHUB_TOKEN 不再注入客户端 bundle（任何访问者都可从浏览器提取）。
    // 改为无认证请求（60 次/小时/IP 的公开限流），配合 localStorage 缓存足够使用。
    // 如需更高限额，应通过服务端代理转发 GitHub API 请求。
    const headers: Record<string, string> = { Accept: 'application/vnd.github.v3+json' };

    fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { headers })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
      .then((json: RepoData) => {
        if (cancelled) return;
        // 安全校验：html_url 必须是 https 字符串，缺失/非字符串/协议不符一律拒绝，
        // 防止 <a href={undefined}> 静默渲染或 javascript: 协议注入
        if (typeof json.html_url !== 'string' || !json.html_url.startsWith('https://')) {
          throw new Error('Invalid html_url');
        }
        setData(json);
        setStatus('loaded');
        try {
          localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: json }));
        } catch (e) { console.warn('GitHub repo cache write failed:', e); }
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [owner, repo]);

  // 加载态：骨架屏（细线占位，沿用全局 .skeleton 动效）
  if (status === 'loading') {
    return (
      <div
        className={`rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-5 ${className || ''}`}
        role="status"
        aria-label="加载仓库信息"
      >
        <div className="skeleton h-5 w-40 rounded-[2px]" />
        <div className="skeleton mt-3 h-4 w-full rounded-[2px]" />
        <div className="skeleton mt-2 h-4 w-3/4 rounded-[2px]" />
        <div className="mt-4 flex gap-4">
          <div className="skeleton h-4 w-16 rounded-[2px]" />
          <div className="skeleton h-4 w-16 rounded-[2px]" />
        </div>
      </div>
    );
  }

  // 错误态：降级为静态链接
  if (status === 'error') {
    return (
      <a
        href={`https://github.com/${owner}/${repo}`}
        target="_blank"
        rel="noopener noreferrer"
        className={`focus-ring block rounded-[3px] border border-[var(--sf-line)] p-5 no-underline transition-colors hover:border-[var(--sf-accent)] ${className || ''}`}
      >
        <span className="font-mono text-sm font-semibold text-[var(--sf-accent-ink)]">
          {owner}/{repo}
        </span>
        <p className="mt-1 text-xs text-[var(--sf-ink-3)]">在 GitHub 上查看 →</p>
      </a>
    );
  }

  // 空状态
  if (!data) return null;

  // 加载成功
  return (
    <a
      href={data.html_url}
      target="_blank"
      rel="noopener noreferrer"
      className={`group focus-ring block rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-5 no-underline transition-colors hover:border-[var(--sf-accent)] ${className || ''}`}
    >
      <div className="flex items-center gap-2">
        <svg className="h-4 w-4 shrink-0 text-[var(--sf-ink-3)]" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0022 12.017C22 6.484 17.522 2 12 2z" />
        </svg>
        <span className="truncate text-sm font-semibold text-[var(--sf-ink)] transition-colors group-hover:text-[var(--sf-accent-ink)]">
          {data.full_name}
        </span>
      </div>

      {data.description && (
        <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-[var(--sf-ink-2)]">
          {data.description}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-[var(--sf-ink-3)]">
        {data.language && (
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[1px] border border-[var(--sf-line-strong)] bg-[var(--sf-canvas)]" aria-hidden="true" />
            {data.language}
          </span>
        )}
        <span className="flex items-center gap-1">
          <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 .587l3.668 7.568L24 9.75l-6 5.847L19.336 24 12 19.897 4.664 24 6 15.597 0 9.75l8.332-1.595z" />
          </svg>
          {data.stargazers_count}
        </span>
        <span className="flex items-center gap-1">
          <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 3a3 3 0 012.99 2.75H21a1 1 0 01.117 1.993L21 7.75h-.5v2.647a2.75 2.75 0 01-.495 1.583l-.135.172-2.922 3.478a2.75 2.75 0 01-.514.485l-.157.1-.16.083c-.36.161-.752.249-1.154.252H9.038c-.402-.003-.794-.09-1.154-.252l-.16-.083-.157-.1a2.75 2.75 0 01-.514-.485L4.13 12.152a2.75 2.75 0 01-.63-1.755V7.75H3a1 1 0 01-.993-.883L2 6.75a1 1 0 01.883-.993L3 5.75h2.01A3 3 0 016 3z" />
          </svg>
          {data.forks_count}
        </span>
        {data.topics?.slice(0, 3).map((topic) => (
          <span key={topic} className="rounded-[2px] border border-[var(--sf-line)] px-2 py-0.5 font-mono text-[10px] text-[var(--sf-ink-3)]">
            {topic}
          </span>
        ))}
      </div>
    </a>
  );
}
