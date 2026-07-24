import React, { useState, useEffect } from 'react';

/**
 * GitHub Repo Card 组件 —— 异步加载仓库信息，缓存兜底。
 *
 * 展示层归类：👁️ 用户可见层
 * 隔离方式：Scoped CSS（Tailwind class，不污染全局）
 * 三态规范：加载态（骨架屏）/ 错误态（降级为静态链接）/ 空状态（不渲染）
 * 缓存：localStorage 缓存 1 小时，减少 API 调用
 *
 * 用法（在 /projects 页面或文章中追加）：
 * <GitHubRepoCard owner="hb-degithub" repo="grbok" client:visible />
 *
 * 分支名：feat/github-repo-card
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
    // 可选 token：通过环境变量 GITHUB_TOKEN 配置，提升 API 限流到 5000/小时
    const ghToken = import.meta.env.GITHUB_TOKEN || '';
    const headers: Record<string, string> = { Accept: 'application/vnd.github.v3+json' };
    if (ghToken) headers.Authorization = `Bearer ${ghToken}`;

    fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { headers })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
      .then((json: RepoData) => {
        if (cancelled) return;
        // 安全校验：确保 html_url 是 https 协议，防止篡改注入
        if (typeof json.html_url === 'string' && !json.html_url.startsWith('https://')) {
          throw new Error('Invalid html_url protocol');
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

  // 加载态：骨架屏
  if (status === 'loading') {
    return (
      <div
        className={`gh-repo-card animate-pulse rounded-xl border border-zinc-200 p-5 dark:border-zinc-800 ${className || ''}`}
        role="status"
        aria-label="加载仓库信息"
      >
        <div className="h-5 w-40 rounded bg-zinc-200 dark:bg-zinc-700" />
        <div className="mt-3 h-4 w-full rounded bg-zinc-100 dark:bg-zinc-800" />
        <div className="mt-2 h-4 w-3/4 rounded bg-zinc-100 dark:bg-zinc-800" />
        <div className="mt-4 flex gap-4">
          <div className="h-4 w-16 rounded bg-zinc-100 dark:bg-zinc-800" />
          <div className="h-4 w-16 rounded bg-zinc-100 dark:bg-zinc-800" />
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
        className={`gh-repo-card block rounded-xl border border-zinc-200 p-5 no-underline transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700 ${className || ''}`}
      >
        <span className="text-sm font-semibold text-teal-600 dark:text-teal-400">
          {owner}/{repo}
        </span>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">在 GitHub 上查看 →</p>
      </a>
    );
  }

  // 空状态
  if (!data) return null;

  // 加载成功
  const langColor: Record<string, string> = {
    TypeScript: '#3178c6',
    JavaScript: '#f1e05a',
    Python: '#3572A5',
    Go: '#00ADD8',
    Rust: '#dea584',
  };

  return (
    <a
      href={data.html_url}
      target="_blank"
      rel="noopener noreferrer"
      className={`gh-repo-card block rounded-xl border border-zinc-200 bg-white p-5 no-underline transition-all hover:-translate-y-0.5 hover:shadow-lg dark:border-zinc-800 dark:bg-zinc-900 ${className || ''}`}
    >
      <div className="flex items-center gap-2">
        <svg className="h-4 w-4 text-zinc-500 dark:text-zinc-400" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0022 12.017C22 6.484 17.522 2 12 2z" />
        </svg>
        <span className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
          {data.full_name}
        </span>
      </div>

      {data.description && (
        <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400 line-clamp-2">
          {data.description}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400">
        {data.language && (
          <span className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: langColor[data.language] || '#8b949e' }}
            />
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
          <span key={topic} className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">
            {topic}
          </span>
        ))}
      </div>
    </a>
  );
}
