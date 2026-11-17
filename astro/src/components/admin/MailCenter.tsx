import { useState, useEffect, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useMailCenter, useSmtpConfig, useMailTemplate, type TabKey } from '../../hooks/domains/useMailCenter';
import type { TemplateItem } from '../../lib/services/mailService';
import { describePbError } from '../../lib/pb-error';
import { notifyStepUpExpired } from '../../lib/step-up-recovery';
import { getSecurityPolicies, putSecurityPolicies, type PolicyDto } from '../../lib/admin-security-policy';

/* ===========================
   设计语言（后台内部页）
   - 只用 --sf-* 令牌：surface/canvas + 四档细线 + 三档墨色 + 单一强调色；
   - 圆角统一 3px（徽标 2px），表格/列表靠 1px 细线分隔；
   - 状态色只用于语义：成功 emerald、警告 amber、失败/危险 --sf-danger、进行中 accent。
   =========================== */

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

/** 队列状态 → 语义色。中性态保持 ink-3，避免整张表出现三种以上强调色。 */
const STATUS_TONE: Record<string, Tone> = {
  pending: 'neutral',
  processing: 'accent',
  retry: 'warning',
  sent: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

const TONE_CHIP: Record<Tone, string> = {
  neutral: 'border-[var(--sf-line)] text-[var(--sf-ink-3)]',
  accent: 'border-[var(--sf-accent)] text-[var(--sf-accent)]',
  success: 'border-emerald-600/45 text-emerald-700 dark:border-emerald-400/45 dark:text-emerald-300',
  warning: 'border-amber-600/45 text-amber-700 dark:border-amber-400/45 dark:text-amber-300',
  danger: 'border-[var(--sf-danger)] text-[var(--sf-danger)]',
};

const TONE_VALUE: Record<Tone, string> = {
  neutral: 'text-[var(--sf-ink)]',
  accent: 'text-[var(--sf-accent)]',
  success: 'text-emerald-700 dark:text-emerald-300',
  warning: 'text-amber-700 dark:text-amber-300',
  danger: 'text-[var(--sf-danger)]',
};

const BTN_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-[3px] border font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)] disabled:cursor-not-allowed disabled:opacity-50';
const BTN_PRIMARY =
  'border-[var(--sf-accent)] bg-[var(--sf-accent)] text-[var(--sf-on-accent)] hover:border-[var(--sf-accent-ink)] hover:bg-[var(--sf-accent-ink)]';
const BTN_SECONDARY =
  'border-[var(--sf-line-control)] bg-[var(--sf-surface)] text-[var(--sf-ink)] hover:border-[var(--sf-accent)] hover:text-[var(--sf-accent-ink)]';
const BTN_MD = 'min-h-9 px-3 text-[13px]';
const BTN_SM = 'min-h-8 px-2.5 text-[12px]';

const FILTER_ON = 'border-[var(--sf-accent)] bg-[var(--sf-accent)] text-[var(--sf-on-accent)]';
const FILTER_OFF =
  'border-[var(--sf-line)] bg-[var(--sf-surface)] text-[var(--sf-ink-2)] hover:border-[var(--sf-line-strong)] hover:text-[var(--sf-ink)]';

const INPUT_BASE =
  'min-w-0 rounded-[3px] border border-[var(--sf-line-control)] bg-[var(--sf-canvas)] text-[13px] text-[var(--sf-ink)] placeholder:text-[var(--sf-ink-3)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--sf-accent)]';
const INPUT_FULL = 'w-full px-2.5 py-1.5';
const INPUT_SM = 'w-20 px-2 py-1';
const LABEL = 'mb-1 block font-mono text-[11px] tracking-[0.08em] text-[var(--sf-ink-3)]';

const TABLE_HEAD =
  'border-b border-[var(--sf-line)] bg-[var(--sf-canvas)] text-left font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--sf-ink-3)]';
const TABLE_ROW = 'border-b border-[var(--sf-line-soft)] transition-colors last:border-b-0 hover:bg-[var(--sf-canvas)]';
const TH = 'whitespace-nowrap px-3 py-2 font-medium';
const TD = 'whitespace-nowrap px-3 py-2 align-middle';

const NOTE = 'text-[11px] leading-relaxed text-[var(--sf-ink-3)]';

function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-[2px] border px-1.5 py-0.5 font-mono text-[10px] leading-none tracking-[0.08em]',
        TONE_CHIP[tone]
      )}
    >
      {children}
    </span>
  );
}

function Section({
  index,
  title,
  hint,
  as = 'h2',
  bodyClassName,
  children,
}: {
  index: string;
  title: string;
  hint?: string;
  as?: 'h2' | 'h3' | 'div';
  bodyClassName?: string;
  children: ReactNode;
}) {
  const titleCls = 'text-[13px] font-semibold tracking-tight text-[var(--sf-ink)]';
  return (
    <section className="min-w-0 overflow-hidden rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[var(--sf-line)] px-3 py-2">
        <span className="font-mono text-[10px] tracking-[0.2em] text-[var(--sf-ink-3)]">{index}</span>
        {as === 'h3' ? (
          <h3 className={titleCls}>{title}</h3>
        ) : as === 'div' ? (
          <div className={titleCls}>{title}</div>
        ) : (
          <h2 className={titleCls}>{title}</h2>
        )}
        <span className="ml-1 h-px min-w-4 flex-1 bg-[var(--sf-line)]" aria-hidden="true" />
        {hint && (
          <span className="font-mono text-[10px] tracking-[0.12em] text-[var(--sf-ink-3)]">{hint}</span>
        )}
      </div>
      <div className={bodyClassName ?? 'p-3'}>{children}</div>
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: number | string; tone: Tone }) {
  return (
    <div className="min-w-0 rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] px-3 py-2.5">
      <p className="font-mono text-[10px] tracking-[0.14em] text-[var(--sf-ink-3)]">{label}</p>
      <p
        className={cx(
          'mt-1 font-display text-2xl font-black leading-none tracking-tight tabular-nums [overflow-wrap:anywhere]',
          TONE_VALUE[tone]
        )}
      >
        {value}
      </p>
    </div>
  );
}

function Datum({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[10px] tracking-[0.12em] text-[var(--sf-ink-3)]">{label}</dt>
      <dd className="mt-0.5 break-words text-[13px] font-medium text-[var(--sf-ink)] [overflow-wrap:anywhere]">
        {value}
      </dd>
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] px-3 py-8 text-center">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--sf-ink-3)]">EMPTY / 0</p>
      <p className="text-[13px] text-[var(--sf-ink-2)]">{text}</p>
    </div>
  );
}

export default function MailCenter() {
  const {
    tab, setTab, overview, queueItems, queueStatus, setQueueStatus,
    logItems, logResult, setLogResult, verifyData, templateItems,
    ruleData, suppressItems, loading, error, status,
    runVerify, loadTabData, loadTemplates,
  } = useMailCenter();

  useEffect(() => { loadTabData(tab); }, [tab, loadTabData]);

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
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-w-0 space-y-4">
      {/* 页头：等宽短标签 + 标题 + 一句话说明 */}
      <header className="min-w-0">
        <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--sf-ink-3)]">
          <span className="h-1 w-1 bg-[var(--sf-accent)]" aria-hidden="true" />
          Mail / Center
        </p>
        <h1 className="mt-1.5 text-xl font-bold leading-none tracking-tight text-[var(--sf-ink)]">邮件中心</h1>
        <p className="mt-1.5 text-[13px] text-[var(--sf-ink-2)]">运营闭环的邮件治理面板</p>
      </header>

      {/* 分区索引：序号 + 标签，选中项只改底色与强调点 */}
      <div className="overflow-x-auto">
        <div
          className="flex min-w-max items-stretch overflow-hidden rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)]"
          role="group"
          aria-label="邮件中心分区"
        >
          {tabs.map((t, i) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'flex min-h-10 items-center gap-2 border-r border-[var(--sf-line)] px-3 text-[13px] font-medium transition-colors last:border-r-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--sf-accent)]',
                  active
                    ? 'bg-[var(--sf-line-soft)] text-[var(--sf-ink)]'
                    : 'text-[var(--sf-ink-2)] hover:bg-[var(--sf-canvas)] hover:text-[var(--sf-ink)]'
                )}
              >
                <span className="font-mono text-[10px] tracking-[0.12em] text-[var(--sf-ink-3)]">{String(i + 1).padStart(2, '0')}</span>
                <span className="whitespace-nowrap">{t.label}</span>
                {active && <span className="h-1 w-1 bg-[var(--sf-accent)]" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-[3px] border border-[var(--sf-danger)] bg-[var(--sf-surface)] px-3 py-2">
          <span className="mt-0.5 shrink-0 font-mono text-[10px] tracking-[0.16em] text-[var(--sf-danger)]">ERR</span>
          <p className="min-w-0 flex-1 break-words text-[13px] text-[var(--sf-danger)] [overflow-wrap:anywhere]">{error}</p>
        </div>
      )}
      {status && (
        <div className="flex items-start gap-2 rounded-[3px] border border-[var(--sf-line-strong)] bg-[var(--sf-surface)] px-3 py-2">
          <span className="mt-0.5 shrink-0 font-mono text-[10px] tracking-[0.16em] text-[var(--sf-ink-3)]">STATUS</span>
          <p className="min-w-0 flex-1 break-words text-[13px] text-[var(--sf-ink-2)] [overflow-wrap:anywhere]">{status}</p>
        </div>
      )}
      {loading && (
        <p className="flex items-center gap-2 font-mono text-[11px] tracking-[0.18em] text-[var(--sf-ink-3)]">
          <span className="h-1 w-1 animate-pulse bg-[var(--sf-accent)]" aria-hidden="true" />
          加载中…
        </p>
      )}

      {tab === 'overview' && overview && !loading && (
        <div className="space-y-3">
          <Section
            index="01"
            title="网关状态"
            hint={overview.gateway?.configured ? 'CONFIGURED' : 'UNCONFIGURED'}
          >
            {overview.gateway?.configured ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px] sm:grid-cols-3">
                <Datum label="服务商" value={overview.gateway.providerLabel || '-'} />
                <Datum label="端口" value={overview.gateway.port || '-'} />
                <Datum label="发件域" value={overview.gateway.fromDomain || '-'} />
                <Datum label="TLS" value={overview.gateway.tlsMode || '-'} />
                <Datum
                  label="上次验证"
                  value={overview.gateway.lastVerify ? fmtDate(overview.gateway.lastVerify) : '从未'}
                />
              </dl>
            ) : (
              <p className="break-words text-[13px] text-[var(--sf-danger)] [overflow-wrap:anywhere]">
                {overview.gateway?.error || 'SMTP 网关未配置或不可用'}
              </p>
            )}
          </Section>

          <Section index="02" title="投递指标">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              <Metric label="24h 发送" value={overview.summary.sent_24h} tone="success" />
              <Metric label="24h 失败" value={overview.summary.failed_24h} tone="danger" />
              <Metric label="成功率" value={`${overview.summary.success_rate}%`} tone="accent" />
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <Metric label="等待中" value={overview.summary.pending} tone="neutral" />
              <Metric label="处理中" value={overview.summary.processing} tone="accent" />
              <Metric label="重试中" value={overview.summary.retry} tone="warning" />
              <Metric label="最终失败" value={overview.summary.failed_outbox} tone="danger" />
            </div>
          </Section>
        </div>
      )}

      {tab === 'queue' && !loading && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="队列状态筛选">
            {['', 'pending', 'processing', 'retry', 'sent', 'failed', 'cancelled'].map((s) => (
              <button
                key={s || 'all'}
                type="button"
                onClick={() => setQueueStatus(s)}
                aria-pressed={queueStatus === s}
                className={cx(
                  'min-h-8 rounded-[3px] border px-2.5 font-mono text-[11px] tracking-[0.06em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)]',
                  queueStatus === s ? FILTER_ON : FILTER_OFF
                )}
              >
                {s || '全部'}
              </button>
            ))}
          </div>
          {queueItems.length === 0 ? <EmptyNote text="暂无队列记录" /> : (
            <Section index="01" title="队列记录" hint={`${queueItems.length} 条`} bodyClassName="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[46rem] border-collapse text-[13px]">
                  <caption className="sr-only">邮件发送队列</caption>
                  <thead>
                    <tr className={TABLE_HEAD}>
                      <th scope="col" className={TH}>状态</th>
                      <th scope="col" className={TH}>分类</th>
                      <th scope="col" className={TH}>收件人</th>
                      <th scope="col" className={TH}>尝试</th>
                      <th scope="col" className={TH}>下次重试</th>
                      <th scope="col" className={TH}>错误</th>
                      <th scope="col" className={TH}>创建</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queueItems.map((item) => (
                      <tr key={item.id} className={TABLE_ROW}>
                        <td className={TD}>
                          <Chip tone={STATUS_TONE[item.status] || 'neutral'}>{item.status}</Chip>
                        </td>
                        <td className={cx(TD, 'text-[var(--sf-ink-2)]')}>{item.category}</td>
                        <td className={cx(TD, 'font-mono text-[11px] text-[var(--sf-ink-2)]')}>{item.recipient_masked || '***'}</td>
                        <td className={cx(TD, 'font-mono text-[11px] text-[var(--sf-ink-2)]')}>{item.attempt}</td>
                        <td className={cx(TD, 'font-mono text-[11px] text-[var(--sf-ink-3)]')}>
                          {item.next_attempt_at ? fmtDate(item.next_attempt_at) : '-'}
                        </td>
                        <td className={cx(TD, 'font-mono text-[11px]')}>
                          {item.last_error_class
                            ? <span className="text-[var(--sf-danger)]">{item.last_error_class}</span>
                            : <span className="text-[var(--sf-ink-3)]">-</span>}
                        </td>
                        <td className={cx(TD, 'font-mono text-[11px] text-[var(--sf-ink-3)]')}>{fmtDate(item.created)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}
          <p className={NOTE}>收件人已脱敏，不展示完整邮箱、正文或 token。</p>
        </div>
      )}

      {tab === 'logs' && !loading && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="投递日志结果筛选">
            {['', 'sent', 'failed'].map((r) => (
              <button
                key={r || 'all'}
                type="button"
                onClick={() => setLogResult(r)}
                aria-pressed={logResult === r}
                className={cx(
                  'min-h-8 rounded-[3px] border px-2.5 font-mono text-[11px] tracking-[0.06em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)]',
                  logResult === r ? FILTER_ON : FILTER_OFF
                )}
              >
                {r || '全部'}
              </button>
            ))}
          </div>
          {logItems.length === 0 ? <EmptyNote text="暂无投递日志" /> : (
            <Section index="01" title="投递日志" hint={`${logItems.length} 条`} bodyClassName="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[46rem] border-collapse text-[13px]">
                  <caption className="sr-only">邮件投递日志</caption>
                  <thead>
                    <tr className={TABLE_HEAD}>
                      <th scope="col" className={TH}>结果</th>
                      <th scope="col" className={TH}>分类</th>
                      <th scope="col" className={TH}>来源</th>
                      <th scope="col" className={TH}>耗时(ms)</th>
                      <th scope="col" className={TH}>尝试</th>
                      <th scope="col" className={TH}>错误分类</th>
                      <th scope="col" className={TH}>时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logItems.map((item) => (
                      <tr key={item.id} className={TABLE_ROW}>
                        <td className={TD}>
                          <Chip tone={item.result === 'sent' ? 'success' : 'danger'}>{item.result}</Chip>
                        </td>
                        <td className={cx(TD, 'text-[var(--sf-ink-2)]')}>{item.category}</td>
                        <td className={cx(TD, 'text-[var(--sf-ink-2)]')}>{item.source_kind}</td>
                        <td className={cx(TD, 'font-mono text-[11px] text-[var(--sf-ink-2)]')}>{item.duration_ms}</td>
                        <td className={cx(TD, 'font-mono text-[11px] text-[var(--sf-ink-2)]')}>{item.attempt}</td>
                        <td className={cx(TD, 'font-mono text-[11px]')}>
                          {item.error_class
                            ? <span className="text-[var(--sf-danger)]">{item.error_class}</span>
                            : <span className="text-[var(--sf-ink-3)]">-</span>}
                        </td>
                        <td className={cx(TD, 'font-mono text-[11px] text-[var(--sf-ink-3)]')}>{fmtDate(item.created)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}
          <p className={NOTE}>日志只保存最小投递摘要，不包含正文、token、OTP 或 SMTP 原文。</p>
        </div>
      )}

      {tab === 'templates' && !loading && (
        <div className="space-y-3">
          {templateItems.length === 0 ? <EmptyNote text="暂无模板" /> : (
            <div className="space-y-3">
              {templateItems.map((item, i) => (
                <TemplatePanel key={item.id} item={item} ordinal={i + 1} onSaved={loadTemplates} />
              ))}
            </div>
          )}
          <p className={NOTE}>文案中用 {'{{变量名}}'} 引用变量；必需变量的占位符必须保留。测试邮件发送到当前登录管理员的邮箱。</p>
        </div>
      )}

      {tab === 'rules' && !loading && ruleData && (
        <div className="space-y-3">
          <MailRatePolicyEditor />
          <Section index="02" title="限流策略" bodyClassName="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] border-collapse text-[13px]">
                <caption className="sr-only">邮件限流策略</caption>
                <thead>
                  <tr className={TABLE_HEAD}>
                    <th scope="col" className={TH}>策略</th>
                    <th scope="col" className={TH}>限额</th>
                    <th scope="col" className={TH}>窗口(秒)</th>
                    <th scope="col" className={TH}>版本</th>
                  </tr>
                </thead>
                <tbody>
                  {ruleData.policies.map((p) => (
                    <tr key={p.key} className={TABLE_ROW}>
                      <td className={cx(TD, 'font-mono text-[11px] text-[var(--sf-ink-2)]')}>{p.key}</td>
                      <td className={cx(TD, 'font-mono text-[11px] text-[var(--sf-ink-2)]')}>{p.limit}</td>
                      <td className={cx(TD, 'font-mono text-[11px] text-[var(--sf-ink-2)]')}>{p.window_seconds}</td>
                      <td className={cx(TD, 'font-mono text-[11px] text-[var(--sf-ink-3)]')}>{p.version}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          <Section index="03" title="系统来源">
            <div>
              {ruleData.system_sources.map((s) => (
                <div
                  key={s.key}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-[var(--sf-line-soft)] py-1.5 last:border-b-0 last:pb-0"
                >
                  <span className="min-w-0 break-words text-[13px] text-[var(--sf-ink-2)] [overflow-wrap:anywhere]">{s.label}</span>
                  <span className="font-mono text-[11px] text-[var(--sf-ink-3)]">{s.source}</span>
                </div>
              ))}
            </div>
          </Section>
          <p className={NOTE}>{ruleData.note}</p>
        </div>
      )}

      {tab === 'suppress' && !loading && (
        <div className="space-y-3">
          {suppressItems.length === 0 ? <EmptyNote text="暂无永久抑制记录" /> : (
            <Section index="01" title="永久抑制" hint={`${suppressItems.length} 条`} bodyClassName="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[32rem] border-collapse text-[13px]">
                  <caption className="sr-only">永久抑制记录</caption>
                  <thead>
                    <tr className={TABLE_HEAD}>
                      <th scope="col" className={TH}>分类</th>
                      <th scope="col" className={TH}>收件人</th>
                      <th scope="col" className={TH}>错误</th>
                      <th scope="col" className={TH}>时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suppressItems.map((item) => (
                      <tr key={item.id} className={TABLE_ROW}>
                        <td className={cx(TD, 'text-[var(--sf-ink-2)]')}>{item.category}</td>
                        <td className={cx(TD, 'font-mono text-[11px] text-[var(--sf-ink-2)]')}>{item.recipient_masked}</td>
                        <td className={cx(TD, 'font-mono text-[11px] text-[var(--sf-danger)]')}>{item.last_error_class}</td>
                        <td className={cx(TD, 'font-mono text-[11px] text-[var(--sf-ink-3)]')}>{fmtDate(item.created)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}
          <p className={NOTE}>仅展示因永久地址错误而最终失败的记录；解除抑制需重新触发合法业务事件。</p>
        </div>
      )}

      {tab === 'smtp' && <SmtpSettingsPanel />}

      {tab === 'verify' && !loading && (
        <div className="space-y-3">
          <Section index="01" title="SMTP 连接验证">
            <p className="text-[13px] leading-relaxed text-[var(--sf-ink-2)]">验证 admin-auth 网关的 SMTP 连接状态。此操作只检查连接，不发送测试邮件。</p>
            <div className="mt-3">
              <button
                type="button"
                onClick={runVerify}
                disabled={loading}
                className={cx(BTN_BASE, BTN_PRIMARY, BTN_MD)}
              >
                {loading ? '验证中…' : '验证连接'}
              </button>
            </div>
          </Section>
          {verifyData && (
            <Section index="02" title="验证结果" as="h3">
              <div className="mb-3">
                <Chip tone={verifyData.verified ? 'success' : 'danger'}>{verifyData.verified ? '已连接' : '未连接'}</Chip>
              </div>
              {verifyData.gateway && (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px] sm:grid-cols-3">
                  <Datum label="已配置" value={verifyData.gateway.configured ? '是' : '否'} />
                  <Datum label="服务商" value={verifyData.gateway.providerLabel || '-'} />
                  <Datum label="检查时间" value={fmtDate(verifyData.checked_at)} />
                </dl>
              )}
              {verifyData.error && (
                <p className="mt-2 break-words text-[13px] text-[var(--sf-danger)] [overflow-wrap:anywhere]">{verifyData.error}</p>
              )}
            </Section>
          )}
        </div>
      )}
    </motion.div>
  );
}

function SmtpSettingsPanel() {
  const { form, hasPassword, updatedAt, loading, saving, verifying, message, load, patch, save } = useSmtpConfig();
  useEffect(() => { void load(); }, [load]);
  if (loading) {
    return <p className="font-mono text-[11px] tracking-[0.18em] text-[var(--sf-ink-3)]">加载中…</p>;
  }
  return (
    <div className="space-y-3">
      <Section index="01" title="SMTP 发送配置">
        <p className="text-[13px] leading-relaxed text-[var(--sf-ink-2)]">
          配置阿里云邮件推送（DirectMail）的 SMTP 参数。保存后立即生效，无需重启服务；密码加密存储且永不回显。
          {updatedAt && (
            <span className="ml-1 text-[11px] text-[var(--sf-ink-3)]">（上次更新：{new Date(updatedAt.replace(' ', 'T')).toLocaleString('zh-CN')}）</span>
          )}
        </p>
        <div className="mt-3 grid gap-x-4 gap-y-3 sm:grid-cols-2">
          <div>
            <label className={LABEL} htmlFor="smtp-host">SMTP 主机</label>
            <input id="smtp-host" className={cx(INPUT_BASE, INPUT_FULL)} value={form.host} onChange={(e) => patch('host', e.target.value)} placeholder="smtpdm.aliyun.com" />
          </div>
          <div>
            <label className={LABEL} htmlFor="smtp-port">端口（465=SSL，25/80=STARTTLS）</label>
            <input id="smtp-port" className={cx(INPUT_BASE, INPUT_FULL)} type="number" min={1} max={65535} value={form.port} onChange={(e) => patch('port', Number(e.target.value) || 465)} />
          </div>
          <div>
            <label className={LABEL} htmlFor="smtp-username">SMTP 用户名（发信地址）</label>
            <input id="smtp-username" className={cx(INPUT_BASE, INPUT_FULL)} value={form.username} onChange={(e) => patch('username', e.target.value)} placeholder="noreply@mail.hlydwz.com" autoComplete="off" />
          </div>
          <div>
            <label className={LABEL} htmlFor="smtp-password">SMTP 密码{hasPassword ? '（已保存，留空表示不修改）' : '（必填）'}</label>
            <input id="smtp-password" className={cx(INPUT_BASE, INPUT_FULL)} type="password" value={form.password} onChange={(e) => patch('password', e.target.value)} placeholder={hasPassword ? '••••••••' : 'DirectMail 的 SMTP 密码'} autoComplete="new-password" />
          </div>
          <div>
            <label className={LABEL} htmlFor="smtp-from-address">发件人地址</label>
            <input id="smtp-from-address" className={cx(INPUT_BASE, INPUT_FULL)} value={form.from_address} onChange={(e) => patch('from_address', e.target.value)} placeholder="noreply@mail.hlydwz.com" />
          </div>
          <div>
            <label className={LABEL} htmlFor="smtp-from-name">发件人名称</label>
            <input id="smtp-from-name" className={cx(INPUT_BASE, INPUT_FULL)} value={form.from_name} onChange={(e) => patch('from_name', e.target.value)} placeholder="个人博客" />
          </div>
          <div>
            <label className={LABEL} htmlFor="smtp-tls">TLS 模式</label>
            <select id="smtp-tls" className={cx(INPUT_BASE, INPUT_FULL)} value={form.tls_mode} onChange={(e) => patch('tls_mode', e.target.value)}>
              <option value="auto">自动（按端口判断）</option>
              <option value="implicit">Implicit SSL（465）</option>
              <option value="starttls">STARTTLS（25/80/587）</option>
            </select>
          </div>
          <div className="flex items-end pb-1">
            <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[var(--sf-ink-2)]">
              <input type="checkbox" checked={form.enabled} onChange={(e) => patch('enabled', e.target.checked)} className="h-4 w-4 rounded-[2px] border border-[var(--sf-line-control)] accent-[var(--sf-accent)]" />
              启用此配置（启用后全站邮件由此发出）
            </label>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => void save(false)} disabled={saving || verifying} className={cx(BTN_BASE, BTN_SECONDARY, BTN_MD)}>{saving ? '保存中…' : '保存'}</button>
          <button type="button" onClick={() => void save(true)} disabled={saving || verifying} className={cx(BTN_BASE, BTN_PRIMARY, BTN_MD)}>{verifying ? '验证中…' : saving ? '保存中…' : '保存并验证连接'}</button>
        </div>
        {message && (
          <p className={cx('mt-3 break-words text-[13px] [overflow-wrap:anywhere]', message.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-[var(--sf-danger)]')}>{message.text}</p>
        )}
      </Section>
      <Section index="02" title="阿里云邮件推送参数在哪里" as="h3">
        <ol className="list-decimal space-y-1.5 pl-5 text-[13px] leading-relaxed text-[var(--sf-ink-2)]">
          <li>阿里云控制台 → 邮件推送（DirectMail）→ 发信域名：添加域名（如 mail.hlydwz.com）并按提示完成 DNS 验证（MX/SPF/DKIM 记录）。</li>
          <li>发信地址：新建发信地址（如 noreply@mail.hlydwz.com），类型选"触发邮件"，设置 SMTP 密码。</li>
          <li>SMTP 服务地址：<code className="rounded-[2px] border border-[var(--sf-line)] bg-[var(--sf-canvas)] px-1 py-0.5 font-mono text-[11px] text-[var(--sf-ink-2)]">smtpdm.aliyun.com</code>，SSL 端口 465。</li>
          <li>把发信地址填到上方"SMTP 用户名"和"发件人地址"，SMTP 密码填到"SMTP 密码"。</li>
        </ol>
      </Section>
    </div>
  );
}

interface TemplatePanelProps { item: TemplateItem; ordinal: number; onSaved: () => void; }

function TemplatePanel({ item, ordinal, onSaved }: TemplatePanelProps) {
  const { editing, form, saving, testing, message, hasAction, startEdit, setEditing, setForm, save, runTest } = useMailTemplate(item, onSaved);
  const fieldId = `tpl-${item.key}`;
  return (
    <Section
      index={String(ordinal).padStart(2, '0')}
      title={item.name}
      hint={`v${item.version}`}
      as="div"
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-mono text-[11px] text-[var(--sf-ink-3)]">键：{item.key} · 分类：{item.category}</p>
        {item.builtin && <Chip tone="neutral">内置</Chip>}
      </div>
      {!editing && (
        <>
          <p className="mt-2 break-words text-[13px] leading-relaxed text-[var(--sf-ink-2)] [overflow-wrap:anywhere]">主题模板：{item.subject_template}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {item.variables.map((v) => (
              <span key={v} className="rounded-[2px] border border-[var(--sf-line)] bg-[var(--sf-canvas)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--sf-ink-2)]">{v}</span>
            ))}
          </div>
          {item.required_variables.length > 0 && (
            <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">必需变量：{item.required_variables.join(', ')}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={startEdit} className={cx(BTN_BASE, BTN_SECONDARY, BTN_SM)}>编辑</button>
            <button type="button" onClick={() => void runTest()} disabled={testing} className={cx(BTN_BASE, BTN_PRIMARY, BTN_SM)}>{testing ? '发送中…' : '发送测试邮件'}</button>
          </div>
        </>
      )}
      {editing && (
        <div className="mt-3 space-y-3">
          <div>
            <label className={LABEL} htmlFor={`${fieldId}-subject`}>主题模板（可用变量：{item.variables.map((v) => `{{${v}}}`).join(' ')}）</label>
            <input id={`${fieldId}-subject`} className={cx(INPUT_BASE, INPUT_FULL)} value={form.subject_template} onChange={(e) => setForm((p) => ({ ...p, subject_template: e.target.value }))} />
          </div>
          <div>
            <label className={LABEL} htmlFor={`${fieldId}-preheader`}>预览文本（preheader，收件箱列表里显示的摘要）</label>
            <input id={`${fieldId}-preheader`} className={cx(INPUT_BASE, INPUT_FULL)} value={form.preheader} onChange={(e) => setForm((p) => ({ ...p, preheader: e.target.value }))} />
          </div>
          <div>
            <label className={LABEL} htmlFor={`${fieldId}-title`}>正文标题</label>
            <input id={`${fieldId}-title`} className={cx(INPUT_BASE, INPUT_FULL)} value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} />
          </div>
          <div>
            <label className={LABEL} htmlFor={`${fieldId}-paragraphs`}>正文段落（每行一段）</label>
            <textarea id={`${fieldId}-paragraphs`} className={cx(INPUT_BASE, INPUT_FULL)} rows={Math.max(3, form.paragraphs.split('\n').length + 1)} value={form.paragraphs} onChange={(e) => setForm((p) => ({ ...p, paragraphs: e.target.value }))} />
          </div>
          {hasAction && (
            <div>
              <label className={LABEL} htmlFor={`${fieldId}-action`}>按钮文字（链接地址由系统生成，不可改）</label>
              <input id={`${fieldId}-action`} className={cx(INPUT_BASE, INPUT_FULL)} value={form.action_label} onChange={(e) => setForm((p) => ({ ...p, action_label: e.target.value }))} />
            </div>
          )}
          <div>
            <label className={LABEL} htmlFor={`${fieldId}-footer`}>页脚</label>
            <input id={`${fieldId}-footer`} className={cx(INPUT_BASE, INPUT_FULL)} value={form.footer} onChange={(e) => setForm((p) => ({ ...p, footer: e.target.value }))} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void save()} disabled={saving} className={cx(BTN_BASE, BTN_PRIMARY, BTN_MD)}>{saving ? '保存中…' : '保存'}</button>
            <button type="button" onClick={() => setEditing(false)} className={cx(BTN_BASE, BTN_SECONDARY, BTN_MD)}>取消</button>
          </div>
        </div>
      )}
      {message && (
        <p className={cx('mt-3 break-words text-[13px] [overflow-wrap:anywhere]', message.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-[var(--sf-danger)]')}>{message.text}</p>
      )}
    </Section>
  );
}

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
  useEffect(() => { getSecurityPolicies().then(setDto).catch(() => setStatus({ ok: false, text: '无法读取发信策略（需要有效的二次验证会话）' })); }, []);
  const mailKeys = dto ? Object.keys(dto.policies).filter((k) => k in MAIL_POLICY_LABELS) : [];
  const patch = (key: string, field: 'limit' | 'windowSeconds', value: number) => { if (!dto) return; setDto({ ...dto, policies: { ...dto.policies, [key]: { ...dto.policies[key], [field]: value } } }); };
  const save = async () => { if (!dto) return; setSaving(true); setStatus(null); try { setDto(await putSecurityPolicies(dto)); setStatus({ ok: true, text: '发信频率已保存，即时生效。' }); } catch (err: unknown) { if (notifyStepUpExpired(err)) { setStatus({ ok: false, text: '管理会话已过期，请重新验证动态口令' }); return; } setStatus({ ok: false, text: describePbError(err, '保存失败：请检查数值边界与二次验证会话是否过期。') }); } finally { setSaving(false); } };
  return (
    <Section index="01" title="发信频率">
      <p className="text-[11px] leading-relaxed text-[var(--sf-ink-3)]">单位时间内允许发送的邮件数量，超出后请求将被限流（返回 429 或静默丢弃）。调整即时生效。</p>
      {!dto && !status && (
        <p className="mt-2 font-mono text-[11px] tracking-[0.18em] text-[var(--sf-ink-3)]">加载中…</p>
      )}
      {dto && (
        <div className="mt-3 space-y-2">
          {mailKeys.map((key) => { const value = dto.policies[key]; const bound = dto.bounds[key]; return (
            <div
              key={key}
              className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-[var(--sf-line-soft)] pb-2 last:border-b-0 last:pb-0"
            >
              <span className="w-full text-[12px] text-[var(--sf-ink-2)] sm:w-56 sm:shrink-0">{MAIL_POLICY_LABELS[key]}</span>
              <span className="text-[11px] text-[var(--sf-ink-3)]">每</span>
              <input aria-label={`${key} 窗口秒`} type="number" className={cx(INPUT_BASE, INPUT_SM)} min={bound?.minWindow} max={bound?.maxWindow} value={value.windowSeconds} onChange={(e) => patch(key, 'windowSeconds', Number(e.target.value))} />
              <span className="text-[11px] text-[var(--sf-ink-3)]">秒最多</span>
              <input aria-label={`${key} 限额`} type="number" className={cx(INPUT_BASE, INPUT_SM)} min={bound?.minLimit} max={bound?.maxLimit} value={value.limit} onChange={(e) => patch(key, 'limit', Number(e.target.value))} />
              <span className="text-[11px] text-[var(--sf-ink-3)]">封（{bound ? `${bound.minLimit}-${bound.maxLimit}` : ''}）</span>
            </div>
          ); })}
          <div className="pt-2">
            <button type="button" onClick={() => void save()} disabled={saving} className={cx(BTN_BASE, BTN_PRIMARY, BTN_MD)}>{saving ? '保存中…' : '保存频率设置'}</button>
          </div>
        </div>
      )}
      {status && (
        <p className={cx('mt-3 break-words text-[13px] [overflow-wrap:anywhere]', status.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-[var(--sf-danger)]')}>{status.text}</p>
      )}
    </Section>
  );
}
