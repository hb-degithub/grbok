import React, { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { getPocketBase } from '../../lib/pocketbase';

type TabKey = 'overview' | 'queue' | 'logs' | 'verify';

interface OverviewData {
  gateway: {
    configured?: boolean;
    providerLabel?: string;
    port?: number;
    fromDomain?: string;
    tlsMode?: string;
    lastVerify?: string | null;
    checkedAt?: string;
    error?: string;
  } | null;
  summary: {
    sent_24h: number;
    failed_24h: number;
    success_rate: number;
    pending: number;
    processing: number;
    retry: number;
    failed_outbox: number;
  };
  checked_at: string;
}

interface QueueItem {
  id: string;
  status: string;
  category: string;
  template_key: string;
  recipient_masked: string;
  attempt: number;
  next_attempt_at: string;
  last_error_class: string;
  created: string;
}

interface LogItem {
  id: string;
  event_id: string;
  category: string;
  source_kind: string;
  result: string;
  duration_ms: number;
  attempt: number;
  error_class: string;
  archive_batch_id: string;
  created: string;
}

interface VerifyData {
  verified: boolean;
  gateway: OverviewData['gateway'];
  error: string | null;
  checked_at: string;
}

const STATUS_TONE: Record<string, string> = {
  pending: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  processing: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  retry: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  sent: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  cancelled: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500',
};

export default function MailCenter() {
  const [tab, setTab] = useState<TabKey>('overview');
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [queueStatus, setQueueStatus] = useState('');
  const [logItems, setLogItems] = useState<LogItem[]>([]);
  const [logResult, setLogResult] = useState('');
  const [verifyData, setVerifyData] = useState<VerifyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const send = useCallback(async <T,>(path: string, method: 'GET' | 'POST' = 'GET'): Promise<T> => {
    const pb = getPocketBase();
    return pb.send<T>(path, { method });
  }, []);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await send<OverviewData>('/api/blog-admin/mail/overview');
      setOverview(data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { code?: string } } })?.response?.data?.code || (err as Error)?.message || '无法读取邮件概览';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [send]);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = queueStatus ? `?status=${encodeURIComponent(queueStatus)}` : '';
      const data = await send<{ items: QueueItem[] }>(`/api/blog-admin/mail/queue${params}`);
      setQueueItems(data.items || []);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { code?: string } } })?.response?.data?.code || (err as Error)?.message || '无法读取邮件队列';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [send, queueStatus]);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = logResult ? `?result=${encodeURIComponent(logResult)}` : '';
      const data = await send<{ items: LogItem[] }>(`/api/blog-admin/mail/logs${params}`);
      setLogItems(data.items || []);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { code?: string } } })?.response?.data?.code || (err as Error)?.message || '无法读取邮件日志';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [send, logResult]);

  const runVerify = useCallback(async () => {
    setLoading(true);
    setError('');
    setStatus('');
    try {
      const data = await send<VerifyData>('/api/blog-admin/mail/verify', 'POST');
      setVerifyData(data);
      setStatus(data.verified ? '连接验证成功' : '连接验证失败');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { code?: string } } })?.response?.data?.code || (err as Error)?.message || '验证请求失败';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [send]);

  useEffect(() => {
    if (tab === 'overview') loadOverview();
    else if (tab === 'queue') loadQueue();
    else if (tab === 'logs') loadLogs();
  }, [tab, loadOverview, loadQueue, loadLogs]);

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'overview', label: '概览' },
    { key: 'queue', label: '队列' },
    { key: 'logs', label: '日志' },
    { key: 'verify', label: '连接验证' },
  ];

  const fmtDate = (s: string) => {
    if (!s) return '-';
    try { return new Date(s.replace(' ', 'T')).toLocaleString('zh-CN'); } catch { return s; }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-w-0 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">邮件中心</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">运营闭环的邮件治理面板</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-zinc-200 dark:border-zinc-800 pb-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? 'bg-indigo-600 text-white'
                : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}
      {status && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          {status}
        </div>
      )}

      {loading && <p className="text-sm text-zinc-500 dark:text-zinc-400">加载中…</p>}

      {tab === 'overview' && overview && !loading && (
        <div className="space-y-4">
          <div className="card rounded-xl p-5">
            <h2 className="mb-3 text-base font-semibold text-zinc-900 dark:text-zinc-100">网关状态</h2>
            {overview.gateway?.configured ? (
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <div><dt className="text-zinc-500 dark:text-zinc-400">服务商</dt><dd className="font-medium text-zinc-900 dark:text-zinc-100">{overview.gateway.providerLabel || '-'}</dd></div>
                <div><dt className="text-zinc-500 dark:text-zinc-400">端口</dt><dd className="font-medium text-zinc-900 dark:text-zinc-100">{overview.gateway.port || '-'}</dd></div>
                <div><dt className="text-zinc-500 dark:text-zinc-400">发件域</dt><dd className="font-medium text-zinc-900 dark:text-zinc-100">{overview.gateway.fromDomain || '-'}</dd></div>
                <div><dt className="text-zinc-500 dark:text-zinc-400">TLS</dt><dd className="font-medium text-zinc-900 dark:text-zinc-100">{overview.gateway.tlsMode || '-'}</dd></div>
                <div><dt className="text-zinc-500 dark:text-zinc-400">上次验证</dt><dd className="font-medium text-zinc-900 dark:text-zinc-100">{overview.gateway.lastVerify ? fmtDate(overview.gateway.lastVerify) : '从未'}</dd></div>
              </dl>
            ) : (
              <p className="text-sm text-red-600 dark:text-red-400">{overview.gateway?.error || 'SMTP 网关未配置或不可用'}</p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="card rounded-xl p-4 text-center">
              <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{overview.summary.sent_24h}</p>
              <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500 dark:text-zinc-400">24h 发送</p>
            </div>
            <div className="card rounded-xl p-4 text-center">
              <p className="text-2xl font-black text-red-600 dark:text-red-400">{overview.summary.failed_24h}</p>
              <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500 dark:text-zinc-400">24h 失败</p>
            </div>
            <div className="card rounded-xl p-4 text-center">
              <p className="text-2xl font-black text-indigo-600 dark:text-indigo-400">{overview.summary.success_rate}%</p>
              <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500 dark:text-zinc-400">成功率</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-4">
            <div className="card rounded-xl p-4 text-center">
              <p className="text-xl font-bold text-zinc-700 dark:text-zinc-300">{overview.summary.pending}</p>
              <p className="font-mono text-[10px] uppercase text-zinc-500 dark:text-zinc-400">等待中</p>
            </div>
            <div className="card rounded-xl p-4 text-center">
              <p className="text-xl font-bold text-blue-600 dark:text-blue-400">{overview.summary.processing}</p>
              <p className="font-mono text-[10px] uppercase text-zinc-500 dark:text-zinc-400">处理中</p>
            </div>
            <div className="card rounded-xl p-4 text-center">
              <p className="text-xl font-bold text-amber-600 dark:text-amber-400">{overview.summary.retry}</p>
              <p className="font-mono text-[10px] uppercase text-zinc-500 dark:text-zinc-400">重试中</p>
            </div>
            <div className="card rounded-xl p-4 text-center">
              <p className="text-xl font-bold text-red-600 dark:text-red-400">{overview.summary.failed_outbox}</p>
              <p className="font-mono text-[10px] uppercase text-zinc-500 dark:text-zinc-400">最终失败</p>
            </div>
          </div>
        </div>
      )}

      {tab === 'queue' && !loading && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {['', 'pending', 'processing', 'retry', 'sent', 'failed', 'cancelled'].map((s) => (
              <button
                key={s || 'all'}
                onClick={() => { setQueueStatus(s); }}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                  queueStatus === s
                    ? 'bg-indigo-600 text-white'
                    : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
                }`}
              >
                {s || '全部'}
              </button>
            ))}
          </div>
          {queueItems.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">暂无队列记录</p>
          ) : (
            <div className="card overflow-x-auto rounded-xl">
              <table className="w-full text-sm">
                <thead className="border-b border-zinc-200 dark:border-zinc-800">
                  <tr className="text-left text-zinc-500 dark:text-zinc-400">
                    <th className="px-3 py-2">状态</th>
                    <th className="px-3 py-2">分类</th>
                    <th className="px-3 py-2">收件人</th>
                    <th className="px-3 py-2">尝试</th>
                    <th className="px-3 py-2">下次重试</th>
                    <th className="px-3 py-2">错误</th>
                    <th className="px-3 py-2">创建</th>
                  </tr>
                </thead>
                <tbody>
                  {queueItems.map((item) => (
                    <tr key={item.id} className="border-b border-zinc-100 dark:border-zinc-900">
                      <td className="px-3 py-2"><span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_TONE[item.status] || STATUS_TONE.pending}`}>{item.status}</span></td>
                      <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{item.category}</td>
                      <td className="px-3 py-2 font-mono text-xs text-zinc-600 dark:text-zinc-400">{item.recipient_masked || '***'}</td>
                      <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{item.attempt}</td>
                      <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{item.next_attempt_at ? fmtDate(item.next_attempt_at) : '-'}</td>
                      <td className="px-3 py-2 font-mono text-xs text-red-600 dark:text-red-400">{item.last_error_class || '-'}</td>
                      <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{fmtDate(item.created)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-zinc-400 dark:text-zinc-500">收件人已脱敏，不展示完整邮箱、正文或 token。</p>
        </div>
      )}

      {tab === 'logs' && !loading && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {['', 'sent', 'failed'].map((r) => (
              <button
                key={r || 'all'}
                onClick={() => { setLogResult(r); }}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                  logResult === r
                    ? 'bg-indigo-600 text-white'
                    : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
                }`}
              >
                {r || '全部'}
              </button>
            ))}
          </div>
          {logItems.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">暂无投递日志</p>
          ) : (
            <div className="card overflow-x-auto rounded-xl">
              <table className="w-full text-sm">
                <thead className="border-b border-zinc-200 dark:border-zinc-800">
                  <tr className="text-left text-zinc-500 dark:text-zinc-400">
                    <th className="px-3 py-2">结果</th>
                    <th className="px-3 py-2">分类</th>
                    <th className="px-3 py-2">来源</th>
                    <th className="px-3 py-2">耗时(ms)</th>
                    <th className="px-3 py-2">尝试</th>
                    <th className="px-3 py-2">错误分类</th>
                    <th className="px-3 py-2">时间</th>
                  </tr>
                </thead>
                <tbody>
                  {logItems.map((item) => (
                    <tr key={item.id} className="border-b border-zinc-100 dark:border-zinc-900">
                      <td className="px-3 py-2"><span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${item.result === 'sent' ? STATUS_TONE.sent : STATUS_TONE.failed}`}>{item.result}</span></td>
                      <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{item.category}</td>
                      <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{item.source_kind}</td>
                      <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{item.duration_ms}</td>
                      <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{item.attempt}</td>
                      <td className="px-3 py-2 font-mono text-xs text-red-600 dark:text-red-400">{item.error_class || '-'}</td>
                      <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{fmtDate(item.created)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-zinc-400 dark:text-zinc-500">日志只保存最小投递摘要，不包含正文、token、OTP 或 SMTP 原文。</p>
        </div>
      )}

      {tab === 'verify' && !loading && (
        <div className="space-y-4">
          <div className="card rounded-xl p-5">
            <h2 className="mb-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">SMTP 连接验证</h2>
            <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
              验证 admin-auth 网关的 SMTP 连接状态。此操作只检查连接，不发送测试邮件。
            </p>
            <button
              onClick={runVerify}
              disabled={loading}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? '验证中…' : '验证连接'}
            </button>
          </div>
          {verifyData && (
            <div className="card rounded-xl p-5">
              <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">验证结果</h3>
              <p className="mb-3 text-sm">
                <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${verifyData.verified ? STATUS_TONE.sent : STATUS_TONE.failed}`}>
                  {verifyData.verified ? '已连接' : '未连接'}
                </span>
              </p>
              {verifyData.gateway && (
                <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                  <div><dt className="text-zinc-500 dark:text-zinc-400">已配置</dt><dd className="font-medium text-zinc-900 dark:text-zinc-100">{verifyData.gateway.configured ? '是' : '否'}</dd></div>
                  <div><dt className="text-zinc-500 dark:text-zinc-400">服务商</dt><dd className="font-medium text-zinc-900 dark:text-zinc-100">{verifyData.gateway.providerLabel || '-'}</dd></div>
                  <div><dt className="text-zinc-500 dark:text-zinc-400">检查时间</dt><dd className="font-medium text-zinc-900 dark:text-zinc-100">{fmtDate(verifyData.checked_at)}</dd></div>
                </dl>
              )}
              {verifyData.error && (
                <p className="mt-2 text-sm text-red-600 dark:text-red-400">{verifyData.error}</p>
              )}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}