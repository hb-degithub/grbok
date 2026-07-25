import React, { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { getPocketBase } from '../../lib/pocketbase';

type TabKey = 'overview' | 'queue' | 'logs' | 'templates' | 'rules' | 'suppress' | 'smtp' | 'verify';

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

interface TemplateItem {
  id: string;
  key: string;
  name: string;
  category: string;
  version: number;
  is_current: boolean;
  builtin: boolean;
  subject_template: string;
  variables: string[];
  required_variables: string[];
  content?: {
    preheader?: string;
    title?: string;
    paragraphs?: string[];
    action?: { label?: string; urlVariable?: string } | null;
    footer?: string;
  };
}

interface RulePolicy {
  key: string;
  limit: number;
  window_seconds: number;
  version: number;
}

interface RuleData {
  policies: RulePolicy[];
  system_sources: { key: string; label: string; source: string; editable: boolean }[];
  note: string;
}

interface SuppressItem {
  id: string;
  category: string;
  recipient_masked: string;
  last_error_class: string;
  created: string;
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
  const [templateItems, setTemplateItems] = useState<TemplateItem[]>([]);
  const [ruleData, setRuleData] = useState<RuleData | null>(null);
  const [suppressItems, setSuppressItems] = useState<SuppressItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const send = useCallback(async <T,>(path: string, method: 'GET' | 'POST' | 'PUT' = 'GET', body?: unknown): Promise<T> => {
    const pb = getPocketBase();
    return pb.send<T>(path, { method, ...(body !== undefined ? { body } : {}) });
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

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await send<{ items: TemplateItem[] }>('/api/blog-admin/mail/templates');
      setTemplateItems(data.items || []);
    } catch (err: unknown) {
      setError((err as Error)?.message || '无法读取邮件模板');
    } finally {
      setLoading(false);
    }
  }, [send]);

  const loadRules = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await send<RuleData>('/api/blog-admin/mail/rules');
      setRuleData(data);
    } catch (err: unknown) {
      setError((err as Error)?.message || '无法读取邮件规则');
    } finally {
      setLoading(false);
    }
  }, [send]);

  const loadSuppress = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await send<{ items: SuppressItem[] }>('/api/blog-admin/mail/suppress');
      setSuppressItems(data.items || []);
    } catch (err: unknown) {
      setError((err as Error)?.message || '无法读取抑制列表');
    } finally {
      setLoading(false);
    }
  }, [send]);

  useEffect(() => {
    if (tab === 'overview') loadOverview();
    else if (tab === 'queue') loadQueue();
    else if (tab === 'logs') loadLogs();
    else if (tab === 'templates') loadTemplates();
    else if (tab === 'rules') loadRules();
    else if (tab === 'suppress') loadSuppress();
  }, [tab, loadOverview, loadQueue, loadLogs, loadTemplates, loadRules, loadSuppress]);

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'overview', label: '概览' },
    { key: 'queue', label: '队列' },
    { key: 'logs', label: '日志' },
    { key: 'templates', label: '模板' },
    { key: 'rules', label: '规则' },
    { key: 'suppress', label: '抑制' },
    { key: 'smtp', label: 'SMTP 配置' },
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

      {tab === 'templates' && !loading && (
        <div className="space-y-4">
          {templateItems.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">暂无模板</p>
          ) : (
            <div className="space-y-3">
              {templateItems.map((item) => (
                <TemplateCard key={item.id} item={item} send={send} onSaved={loadTemplates} />
              ))}
            </div>
          )}
          <p className="text-xs text-zinc-400 dark:text-zinc-500">文案中用 {'{{变量名}}'} 引用变量；必需变量的占位符必须保留。测试邮件发送到当前登录管理员的邮箱。</p>
        </div>
      )}

      {tab === 'rules' && !loading && (
        <div className="space-y-4">
          {ruleData && (
            <>
              <MailRatePolicyEditor />
              <div className="card rounded-xl p-5">
                <h2 className="mb-3 text-base font-semibold text-zinc-900 dark:text-zinc-100">限流策略</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-zinc-200 dark:border-zinc-800">
                      <tr className="text-left text-zinc-500 dark:text-zinc-400">
                        <th className="px-3 py-2">策略</th>
                        <th className="px-3 py-2">限额</th>
                        <th className="px-3 py-2">窗口(秒)</th>
                        <th className="px-3 py-2">版本</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ruleData.policies.map((p) => (
                        <tr key={p.key} className="border-b border-zinc-100 dark:border-zinc-900">
                          <td className="px-3 py-2 font-mono text-xs text-zinc-700 dark:text-zinc-300">{p.key}</td>
                          <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{p.limit}</td>
                          <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{p.window_seconds}</td>
                          <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{p.version}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="card rounded-xl p-5">
                <h2 className="mb-3 text-base font-semibold text-zinc-900 dark:text-zinc-100">系统来源</h2>
                <div className="space-y-2">
                  {ruleData.system_sources.map((s) => (
                    <div key={s.key} className="flex items-center justify-between gap-3">
                      <span className="text-sm text-zinc-700 dark:text-zinc-300">{s.label}</span>
                      <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">{s.source}</span>
                    </div>
                  ))}
                </div>
              </div>
              <p className="text-xs text-zinc-400 dark:text-zinc-500">{ruleData.note}</p>
            </>
          )}
        </div>
      )}

      {tab === 'suppress' && !loading && (
        <div className="space-y-4">
          {suppressItems.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">暂无永久抑制记录</p>
          ) : (
            <div className="card overflow-x-auto rounded-xl">
              <table className="w-full text-sm">
                <thead className="border-b border-zinc-200 dark:border-zinc-800">
                  <tr className="text-left text-zinc-500 dark:text-zinc-400">
                    <th className="px-3 py-2">分类</th>
                    <th className="px-3 py-2">收件人</th>
                    <th className="px-3 py-2">错误</th>
                    <th className="px-3 py-2">时间</th>
                  </tr>
                </thead>
                <tbody>
                  {suppressItems.map((item) => (
                    <tr key={item.id} className="border-b border-zinc-100 dark:border-zinc-900">
                      <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{item.category}</td>
                      <td className="px-3 py-2 font-mono text-xs text-zinc-600 dark:text-zinc-400">{item.recipient_masked}</td>
                      <td className="px-3 py-2 font-mono text-xs text-red-600 dark:text-red-400">{item.last_error_class}</td>
                      <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{fmtDate(item.created)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-zinc-400 dark:text-zinc-500">仅展示因永久地址错误而最终失败的记录；解除抑制需重新触发合法业务事件。</p>
        </div>
      )}

      {tab === 'smtp' && (
        <SmtpSettingsPanel send={send} />
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

// ---------- SMTP 配置面板（后台自管理，保存即生效，密码加密存储、不回显）----------

interface SmtpConfigView {
  configured: boolean;
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  from_address: string;
  from_name: string;
  tls_mode: string;
  has_password: boolean;
  updated_at: string;
}

interface SmtpSettingsPanelProps {
  send: <T,>(path: string, method?: 'GET' | 'POST' | 'PUT', body?: unknown) => Promise<T>;
}

function SmtpSettingsPanel({ send }: SmtpSettingsPanelProps) {
  const [form, setForm] = useState({ enabled: false, host: 'smtpdm.aliyun.com', port: 465, username: '', password: '', from_address: '', from_name: '个人博客', tls_mode: 'auto' });
  const [hasPassword, setHasPassword] = useState(false);
  const [updatedAt, setUpdatedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const data = await send<SmtpConfigView>('/api/blog-admin/mail/smtp');
      if (data.configured) {
        setForm({
          enabled: data.enabled,
          host: data.host || 'smtpdm.aliyun.com',
          port: data.port || 465,
          username: data.username || '',
          password: '',
          from_address: data.from_address || '',
          from_name: data.from_name || '个人博客',
          tls_mode: data.tls_mode || 'auto',
        });
        setHasPassword(data.has_password);
        setUpdatedAt(data.updated_at || '');
      }
    } catch (err: unknown) {
      setMessage({ ok: false, text: `读取配置失败：${(err as Error)?.message || '未知错误'}` });
    } finally {
      setLoading(false);
    }
  }, [send]);

  useEffect(() => { void load(); }, [load]);

  const patch = (key: string, value: string | number | boolean) => setForm((prev) => ({ ...prev, [key]: value }));

  const save = async (thenVerify: boolean) => {
    setSaving(true);
    setMessage(null);
    try {
      const data = await send<SmtpConfigView>('/api/blog-admin/mail/smtp', 'PUT', { ...form });
      setHasPassword(data.has_password);
      setUpdatedAt(data.updated_at || '');
      setForm((prev) => ({ ...prev, password: '' }));
      if (thenVerify) {
        setSaving(false);
        setVerifying(true);
        try {
          const result = await send<{ verified: boolean; error: string | null }>('/api/blog-admin/mail/verify', 'POST');
          setMessage(result.verified
            ? { ok: true, text: '已保存，SMTP 连接验证成功。' }
            : { ok: false, text: `已保存，但连接验证失败：${result.error || '未知错误'}` });
        } finally {
          setVerifying(false);
        }
        return;
      }
      setMessage({ ok: true, text: '已保存。' });
    } catch (err: unknown) {
      const code = (err as { response?: { data?: { message?: string; code?: string } } })?.response?.data;
      setMessage({ ok: false, text: `保存失败：${code?.message || code?.code || (err as Error)?.message || '未知错误'}` });
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:text-zinc-100';
  const labelCls = 'mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400';

  if (loading) return <p className="text-sm text-zinc-500 dark:text-zinc-400">加载中…</p>;

  return (
    <div className="space-y-4">
      <div className="card rounded-xl p-5">
        <h2 className="mb-1 text-base font-semibold text-zinc-900 dark:text-zinc-100">SMTP 发送配置</h2>
        <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
          配置阿里云邮件推送（DirectMail）的 SMTP 参数。保存后立即生效，无需重启服务；密码加密存储且永不回显。
          {updatedAt && <span className="ml-1 text-xs">（上次更新：{new Date(updatedAt.replace(' ', 'T')).toLocaleString('zh-CN')}）</span>}
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>SMTP 主机</label>
            <input className={inputCls} value={form.host} onChange={(e) => patch('host', e.target.value)} placeholder="smtpdm.aliyun.com" />
          </div>
          <div>
            <label className={labelCls}>端口（465=SSL，25/80=STARTTLS）</label>
            <input className={inputCls} type="number" min={1} max={65535} value={form.port} onChange={(e) => patch('port', Number(e.target.value) || 465)} />
          </div>
          <div>
            <label className={labelCls}>SMTP 用户名（发信地址）</label>
            <input className={inputCls} value={form.username} onChange={(e) => patch('username', e.target.value)} placeholder="noreply@mail.hlydwz.com" autoComplete="off" />
          </div>
          <div>
            <label className={labelCls}>SMTP 密码{hasPassword ? '（已保存，留空表示不修改）' : '（必填）'}</label>
            <input className={inputCls} type="password" value={form.password} onChange={(e) => patch('password', e.target.value)} placeholder={hasPassword ? '••••••••' : 'DirectMail 的 SMTP 密码'} autoComplete="new-password" />
          </div>
          <div>
            <label className={labelCls}>发件人地址</label>
            <input className={inputCls} value={form.from_address} onChange={(e) => patch('from_address', e.target.value)} placeholder="noreply@mail.hlydwz.com" />
          </div>
          <div>
            <label className={labelCls}>发件人名称</label>
            <input className={inputCls} value={form.from_name} onChange={(e) => patch('from_name', e.target.value)} placeholder="个人博客" />
          </div>
          <div>
            <label className={labelCls}>TLS 模式</label>
            <select className={inputCls} value={form.tls_mode} onChange={(e) => patch('tls_mode', e.target.value)}>
              <option value="auto">自动（按端口判断）</option>
              <option value="implicit">Implicit SSL（465）</option>
              <option value="starttls">STARTTLS（25/80/587）</option>
            </select>
          </div>
          <div className="flex items-end pb-1">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input type="checkbox" checked={form.enabled} onChange={(e) => patch('enabled', e.target.checked)} className="h-4 w-4 rounded border-zinc-300" />
              启用此配置（启用后全站邮件由此发出）
            </label>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <button onClick={() => void save(false)} disabled={saving || verifying} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800">
            {saving ? '保存中…' : '保存'}
          </button>
          <button onClick={() => void save(true)} disabled={saving || verifying} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50">
            {verifying ? '验证中…' : saving ? '保存中…' : '保存并验证连接'}
          </button>
        </div>

        {message && (
          <p className={`mt-3 text-sm ${message.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            {message.text}
          </p>
        )}
      </div>

      <div className="card rounded-xl p-5">
        <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">阿里云邮件推送参数在哪里</h3>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-500 dark:text-zinc-400">
          <li>阿里云控制台 → 邮件推送（DirectMail）→ 发信域名：添加域名（如 mail.hlydwz.com）并按提示完成 DNS 验证（MX/SPF/DKIM 记录）。</li>
          <li>发信地址：新建发信地址（如 noreply@mail.hlydwz.com），类型选"触发邮件"，设置 SMTP 密码。</li>
          <li>SMTP 服务地址：<code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">smtpdm.aliyun.com</code>，SSL 端口 465。</li>
          <li>把发信地址填到上方"SMTP 用户名"和"发件人地址"，SMTP 密码填到"SMTP 密码"。</li>
        </ol>
      </div>
    </div>
  );
}
// ---------- 邮件模板卡片（查看 / 编辑 / 发送测试）----------

interface TemplateCardProps {
  item: TemplateItem;
  send: <T,>(path: string, method?: 'GET' | 'POST' | 'PUT', body?: unknown) => Promise<T>;
  onSaved: () => void;
}

interface TestResult {
  sent: boolean;
  to?: string;
  subject?: string;
  stage?: string;
  error?: string;
}

function TemplateCard({ item, send, onSaved }: TemplateCardProps) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ subject_template: '', preheader: '', title: '', paragraphs: '', footer: '', action_label: '' });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const hasAction = !!(item.content && item.content.action && typeof item.content.action === 'object');

  const startEdit = () => {
    setForm({
      subject_template: item.subject_template || '',
      preheader: item.content?.preheader || '',
      title: item.content?.title || '',
      paragraphs: (item.content?.paragraphs || []).join('\n'),
      footer: item.content?.footer || '',
      action_label: item.content?.action?.label || '',
    });
    setMessage(null);
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const paragraphs = form.paragraphs.split('\n').map((line) => line.trim()).filter(Boolean);
      await send('/api/blog-admin/mail/templates', 'PUT', {
        key: item.key,
        subject_template: form.subject_template,
        preheader: form.preheader,
        title: form.title,
        paragraphs,
        footer: form.footer,
        action_label: form.action_label,
      });
      setMessage({ ok: true, text: '已保存。' });
      setEditing(false);
      onSaved();
    } catch (err: unknown) {
      const code = (err as { response?: { data?: { message?: string; code?: string } } })?.response?.data;
      setMessage({ ok: false, text: `保存失败：${code?.message || code?.code || (err as Error)?.message || '未知错误'}` });
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setMessage(null);
    try {
      const result = await send<TestResult>('/api/blog-admin/mail/test', 'POST', { key: item.key });
      setMessage(result.sent
        ? { ok: true, text: `测试邮件已发送至 ${result.to}（主题：${result.subject}），请查收。` }
        : { ok: false, text: `发送失败（${result.stage === 'render' ? '模板渲染' : 'SMTP 发送'}）：${result.error || '未知错误'}` });
    } catch (err: unknown) {
      setMessage({ ok: false, text: `发送失败：${(err as Error)?.message || '未知错误'}` });
    } finally {
      setTesting(false);
    }
  };

  const inputCls = 'w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:text-zinc-100';
  const labelCls = 'mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400';

  return (
    <div className="card rounded-xl p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-zinc-900 dark:text-zinc-100">{item.name}</span>
          {item.builtin && <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">内置</span>}
        </div>
        <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">v{item.version}</span>
      </div>
      <p className="font-mono text-xs text-zinc-600 dark:text-zinc-400">键：{item.key} · 分类：{item.category}</p>

      {!editing && (
        <>
          <p className="mt-2 break-words text-sm text-zinc-700 dark:text-zinc-300">主题模板：{item.subject_template}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {item.variables.map((v) => (
              <span key={v} className="rounded bg-indigo-100 px-1.5 py-0.5 text-xs text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">{v}</span>
            ))}
          </div>
          {item.required_variables.length > 0 && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">必需变量：{item.required_variables.join(', ')}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={startEdit} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800">编辑</button>
            <button onClick={() => void runTest()} disabled={testing} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50">
              {testing ? '发送中…' : '发送测试邮件'}
            </button>
          </div>
        </>
      )}

      {editing && (
        <div className="mt-3 space-y-3">
          <div>
            <label className={labelCls}>主题模板（可用变量：{item.variables.map((v) => `{{${v}}}`).join(' ') }）</label>
            <input className={inputCls} value={form.subject_template} onChange={(e) => setForm((p) => ({ ...p, subject_template: e.target.value }))} />
          </div>
          <div>
            <label className={labelCls}>预览文本（preheader，收件箱列表里显示的摘要）</label>
            <input className={inputCls} value={form.preheader} onChange={(e) => setForm((p) => ({ ...p, preheader: e.target.value }))} />
          </div>
          <div>
            <label className={labelCls}>正文标题</label>
            <input className={inputCls} value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} />
          </div>
          <div>
            <label className={labelCls}>正文段落（每行一段）</label>
            <textarea className={inputCls} rows={Math.max(3, form.paragraphs.split('\n').length + 1)} value={form.paragraphs} onChange={(e) => setForm((p) => ({ ...p, paragraphs: e.target.value }))} />
          </div>
          {hasAction && (
            <div>
              <label className={labelCls}>按钮文字（链接地址由系统生成，不可改）</label>
              <input className={inputCls} value={form.action_label} onChange={(e) => setForm((p) => ({ ...p, action_label: e.target.value }))} />
            </div>
          )}
          <div>
            <label className={labelCls}>页脚</label>
            <input className={inputCls} value={form.footer} onChange={(e) => setForm((p) => ({ ...p, footer: e.target.value }))} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => void save()} disabled={saving} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50">
              {saving ? '保存中…' : '保存'}
            </button>
            <button onClick={() => setEditing(false)} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800">取消</button>
          </div>
        </div>
      )}

      {message && (
        <p className={`mt-3 text-sm ${message.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}

// ---------- 发信频率编辑（复用安全策略接口，仅展示邮件相关策略）----------

import { getSecurityPolicies, putSecurityPolicies, type PolicyDto } from '../../lib/admin-security-policy';

const MAIL_POLICY_LABELS: Record<string, string> = {
  account_mail_email: '验证码/验证邮件 · 同一邮箱',
  account_mail_ip: '验证码/验证邮件 · 同一 IP',
  account_mail_global: '验证码/验证邮件 · 全站',
  comment_notification: '评论通知邮件',
  outbound_global: '外发邮件 · 全站总阀',
  account_retention_notice: '账号保留提醒邮件',
};

function MailRatePolicyEditor() {
  const [dto, setDto] = useState<PolicyDto | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getSecurityPolicies()
      .then(setDto)
      .catch(() => setStatus({ ok: false, text: '无法读取发信策略（需要有效的二次验证会话）' }));
  }, []);

  const mailKeys = dto ? Object.keys(dto.policies).filter((k) => k in MAIL_POLICY_LABELS) : [];

  const patch = (key: string, field: 'limit' | 'windowSeconds', value: number) => {
    if (!dto) return;
    setDto({ ...dto, policies: { ...dto.policies, [key]: { ...dto.policies[key], [field]: value } } });
  };

  const save = async () => {
    if (!dto) return;
    setSaving(true);
    setStatus(null);
    try {
      setDto(await putSecurityPolicies(dto));
      setStatus({ ok: true, text: '发信频率已保存，即时生效。' });
    } catch {
      setStatus({ ok: false, text: '保存失败：请检查数值边界与二次验证会话是否过期。' });
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-24 rounded-lg border border-zinc-300 bg-transparent px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-600 dark:text-zinc-100';

  return (
    <div className="card rounded-xl p-5">
      <h2 className="mb-1 text-base font-semibold text-zinc-900 dark:text-zinc-100">发信频率</h2>
      <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">单位时间内允许发送的邮件数量，超出后请求将被限流（返回 429 或静默丢弃）。调整即时生效。</p>
      {!dto && !status && <p className="text-sm text-zinc-500 dark:text-zinc-400">加载中…</p>}
      {dto && (
        <div className="space-y-3">
          {mailKeys.map((key) => {
            const value = dto.policies[key];
            const bound = dto.bounds[key];
            return (
              <div key={key} className="flex flex-wrap items-center gap-3">
                <span className="w-56 text-sm text-zinc-700 dark:text-zinc-300">{MAIL_POLICY_LABELS[key]}</span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">每</span>
                <input aria-label={`${key} 窗口秒`} type="number" className={inputCls} min={bound?.minWindow} max={bound?.maxWindow} value={value.windowSeconds} onChange={(e) => patch(key, 'windowSeconds', Number(e.target.value))} />
                <span className="text-xs text-zinc-500 dark:text-zinc-400">秒最多</span>
                <input aria-label={`${key} 限额`} type="number" className={inputCls} min={bound?.minLimit} max={bound?.maxLimit} value={value.limit} onChange={(e) => patch(key, 'limit', Number(e.target.value))} />
                <span className="text-xs text-zinc-500 dark:text-zinc-400">封（{bound ? `${bound.minLimit}-${bound.maxLimit}` : ''}）</span>
              </div>
            );
          })}
          <div className="pt-2">
            <button onClick={() => void save()} disabled={saving} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50">
              {saving ? '保存中…' : '保存频率设置'}
            </button>
          </div>
        </div>
      )}
      {status && (
        <p className={`mt-3 text-sm ${status.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{status.text}</p>
      )}
    </div>
  );
}
