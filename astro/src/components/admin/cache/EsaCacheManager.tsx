import React, { useMemo, useState } from 'react';
import ConfirmDialog from '../../ui/ConfirmDialog';
import { useEsaCache } from '../../../hooks/domains/useEsaCache';
import { cn } from '../../../lib/utils';

/* ESA 缓存管理（科幻简约 · 批次 C5）
   三个面板统一 surface 底 + 冷灰细线 + 3px 圆角；表头 canvas 底 + 等宽小字；
   危险操作（全站刷新 / 吊销式破坏）走 --sf-danger 细线，悬停填充；
   状态 chip 只走语义色：执行中 accent、已完成 emerald、失败 danger、已拒绝 amber。
   凭证保存、URL 解析、刷新任务列表与确认弹窗逻辑完全不变。 */

const CHIP = 'inline-flex shrink-0 items-center rounded-[2px] border px-1.5 py-0.5 font-mono text-[10px] leading-none tracking-[0.08em]';

const STATUS_META: Record<string, { label: string; tone: string }> = {
  submitted: { label: '执行中', tone: 'border-[var(--sf-accent)] text-[var(--sf-accent)]' },
  complete: { label: '已完成', tone: 'border-emerald-600/45 text-emerald-700 dark:border-emerald-400/45 dark:text-emerald-300' },
  failed: { label: '失败', tone: 'border-[var(--sf-danger)] text-[var(--sf-danger)]' },
  rejected: { label: '已拒绝', tone: 'border-amber-600/45 text-amber-700 dark:border-amber-400/45 dark:text-amber-300' },
};

const CONFIG_TONE = {
  enabled: 'border-emerald-600/45 text-emerald-700 dark:border-emerald-400/45 dark:text-emerald-300',
  idle: 'border-amber-600/45 text-amber-700 dark:border-amber-400/45 dark:text-amber-300',
  unset: 'border-[var(--sf-line)] text-[var(--sf-ink-3)]',
} as const;

const TYPE_LABELS: Record<string, string> = {
  purgeall: '全站',
  file: '文件',
  directory: '目录',
};

const PANEL = 'min-w-0 overflow-hidden rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)]';
const PANEL_HEAD = 'flex flex-wrap items-center gap-2 border-b border-[var(--sf-line)] px-4 py-3 sm:px-5';
const PANEL_BODY = 'p-4 sm:p-5';
const HAIRLINE = 'ml-1 h-px min-w-4 flex-1 bg-[var(--sf-line)]';
const LABEL = 'mb-1 block font-mono text-[11px] tracking-[0.08em] text-[var(--sf-ink-3)]';
const INPUT =
  'min-h-[40px] w-full min-w-0 rounded-[3px] border border-[var(--sf-line-control)] bg-[var(--sf-surface)] px-3 py-2 text-[16px] text-[var(--sf-ink)] outline-none transition-colors placeholder:text-[var(--sf-ink-3)] focus-visible:border-[var(--sf-accent)] focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)] disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm';
const BTN_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-[3px] border font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)] disabled:cursor-not-allowed disabled:opacity-40';
const BTN_PRIMARY = 'border-[var(--sf-accent)] bg-[var(--sf-accent)] text-[var(--sf-on-accent)] hover:border-[var(--sf-accent-ink)] hover:bg-[var(--sf-accent-ink)]';
const BTN_SECONDARY = 'border-[var(--sf-line-control)] bg-[var(--sf-surface)] text-[var(--sf-ink-2)] hover:border-[var(--sf-line-strong)] hover:text-[var(--sf-ink)]';
const BTN_DANGER = 'border-[var(--sf-danger)] bg-[var(--sf-surface)] text-[var(--sf-danger)] hover:bg-[var(--sf-danger)] hover:text-[var(--sf-on-accent)]';
const TABLE_HEAD = 'border-b border-[var(--sf-line)] bg-[var(--sf-canvas)] text-left font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--sf-ink-3)]';
const TABLE_ROW = 'border-b border-[var(--sf-line-soft)] transition-colors last:border-b-0 hover:bg-[var(--sf-canvas)]';
const TH = 'whitespace-nowrap px-2 py-2 font-medium';

function formatTime(value: string) {
  if (!value) return '-';
  const date = new Date(value.replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function classifyUrls(text: string): { valid: string[]; invalid: string[]; files: number; directories: number } {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const valid: string[] = [];
  const invalid: string[] = [];
  let files = 0;
  let directories = 0;
  for (const line of lines) {
    if (!/^https?:\/\/\S+$/.test(line)) {
      invalid.push(line);
      continue;
    }
    valid.push(line);
    const path = line.replace(/^https?:\/\/[^/]+/, '').split('?')[0] || '/';
    if (path.endsWith('/')) directories += 1;
    else files += 1;
  }
  return { valid, invalid, files, directories };
}

export default function EsaCacheManager() {
  const { config, tasks, loading, saving, purging, error, notice, save, purgeAll, purgeUrls, refreshTasks, dismissMessages } = useEsaCache();

  const [accessKeyId, setAccessKeyId] = useState('');
  const [accessKeySecret, setAccessKeySecret] = useState('');
  const [siteId, setSiteId] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);

  const [urlText, setUrlText] = useState('');
  const [confirmAllOpen, setConfirmAllOpen] = useState(false);
  const [confirmUrlsOpen, setConfirmUrlsOpen] = useState(false);

  if (config && !configLoaded) {
    setAccessKeyId(config.accessKeyId);
    setSiteId(config.siteId ? String(config.siteId) : '');
    setEnabled(config.enabled);
    setConfigLoaded(true);
  }

  const urlPreview = useMemo(() => classifyUrls(urlText), [urlText]);

  const handleSave = async () => {
    dismissMessages();
    try {
      await save({
        accessKeyId: accessKeyId.trim(),
        accessKeySecret: accessKeySecret || undefined,
        siteId: Number(siteId) || 0,
        enabled,
      });
      setAccessKeySecret('');
    } catch {
      // 错误信息已由 hook 呈现
    }
  };

  const handlePurgeAll = async () => {
    setConfirmAllOpen(false);
    try {
      await purgeAll();
    } catch {
      // 错误信息已由 hook 呈现
    }
  };

  const handlePurgeUrls = async () => {
    setConfirmUrlsOpen(false);
    try {
      await purgeUrls(urlPreview.valid);
      setUrlText('');
    } catch {
      // 错误信息已由 hook 呈现
    }
  };

  const configured = config?.configured === true;
  const configEnabled = config?.enabled === true;
  const purgeDisabled = purging || !configured || !configEnabled;

  return (
    <div className="mx-auto min-w-0 max-w-5xl space-y-6">
      <p className="text-sm text-[var(--sf-ink-2)]">通过阿里云 ESA OpenAPI 刷新边缘缓存，部署后用于清理边缘节点上的过期页面。</p>

      {error && (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-[3px] border border-[var(--sf-danger)] px-4 py-3 text-sm text-[var(--sf-danger)]">
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{error}</span>
          <button type="button" onClick={dismissMessages} className="shrink-0 text-[var(--sf-danger)] transition-opacity hover:opacity-70" aria-label="关闭错误提示">✕</button>
        </div>
      )}
      {notice && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-[3px] border border-emerald-600/45 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-400/45 dark:text-emerald-300">
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{notice}</span>
          <button type="button" onClick={dismissMessages} className="shrink-0 transition-opacity hover:opacity-70" aria-label="关闭提示">✕</button>
        </div>
      )}

      {/* 凭证配置 */}
      <section className={PANEL}>
        <div className={PANEL_HEAD}>
          <h2 className="text-sm font-semibold tracking-tight text-[var(--sf-ink)]">ESA API 凭证</h2>
          <span className={HAIRLINE} aria-hidden="true" />
          {config && (
            <span className={cn(CHIP, configured && configEnabled ? CONFIG_TONE.enabled : configured ? CONFIG_TONE.idle : CONFIG_TONE.unset)}>
              {configured ? (configEnabled ? '已启用' : '已配置未启用') : '未配置'}
            </span>
          )}
        </div>
        <div className={PANEL_BODY}>
          {loading ? (
            <div className="h-24 animate-pulse rounded-[3px] border border-[var(--sf-line-soft)] bg-[var(--sf-canvas)]" aria-hidden="true" />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className={LABEL}>AccessKey ID</span>
                <input
                  type="text"
                  value={accessKeyId}
                  onChange={(event) => setAccessKeyId(event.target.value)}
                  placeholder={config?.hasSecret ? config.accessKeyId : 'LTAI...'}
                  autoComplete="off"
                  className={cn(INPUT, 'font-mono')}
                />
              </label>
              <label className="block">
                <span className={LABEL}>AccessKey Secret{config?.hasSecret && '（留空表示不修改）'}</span>
                <input
                  type="password"
                  value={accessKeySecret}
                  onChange={(event) => setAccessKeySecret(event.target.value)}
                  placeholder={config?.hasSecret ? '已保存，留空保持不变' : '输入 AccessKey Secret'}
                  autoComplete="new-password"
                  className={cn(INPUT, 'font-mono')}
                />
              </label>
              <label className="block">
                <span className={LABEL}>ESA 站点 ID（SiteId）</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={siteId}
                  onChange={(event) => setSiteId(event.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="ESA 控制台站点信息中的数字 ID"
                  className={cn(INPUT, 'font-mono')}
                />
              </label>
              <label className="flex items-end gap-2 pb-2">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) => setEnabled(event.target.checked)}
                  className="h-4 w-4 rounded-[2px] border border-[var(--sf-line-control)] accent-[var(--sf-accent)]"
                />
                <span className="text-sm text-[var(--sf-ink)]">启用 ESA 缓存刷新</span>
              </label>
              <div className="md:col-span-2">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !accessKeyId.trim() || !siteId}
                  className={cn(BTN_BASE, BTN_PRIMARY, 'min-h-10 px-4 text-sm')}
                >
                  {saving ? '保存中…' : '保存配置'}
                </button>
                <p className="mt-2 break-words text-xs text-[var(--sf-ink-3)] [overflow-wrap:anywhere]">Secret 加密后存储，任何接口均不回传明文。建议使用仅授权 ESA 刷新权限的 RAM 子账号。</p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 刷新操作 */}
      <section className={PANEL}>
        <div className={PANEL_HEAD}>
          <h2 className="text-sm font-semibold tracking-tight text-[var(--sf-ink)]">刷新缓存</h2>
          <span className={HAIRLINE} aria-hidden="true" />
        </div>
        <div className={cn(PANEL_BODY, 'space-y-5')}>
          <div className="flex flex-wrap items-center gap-3 rounded-[3px] border border-[var(--sf-danger)] p-4">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-[var(--sf-ink)]">全站刷新</div>
              <p className="mt-0.5 break-words text-xs text-[var(--sf-ink-3)] [overflow-wrap:anywhere]">清除整个站点在 ESA 边缘节点上的全部缓存。部署发布后使用，会短时增加源站回源压力。</p>
            </div>
            <button
              type="button"
              onClick={() => setConfirmAllOpen(true)}
              disabled={purgeDisabled}
              className={cn(BTN_BASE, BTN_DANGER, 'min-h-10 shrink-0 px-4 text-sm')}
            >
              {purging ? '提交中…' : '全站刷新'}
            </button>
          </div>

          <div>
            <div className="mb-1 text-sm font-semibold text-[var(--sf-ink)]">自定义路径刷新</div>
            <p className="mb-2 break-words text-xs text-[var(--sf-ink-3)] [overflow-wrap:anywhere]">每行一个本站完整 URL。以 <code className="rounded-[2px] border border-[var(--sf-line)] bg-[var(--sf-canvas)] px-1 font-mono text-[11px] text-[var(--sf-ink-2)]">/</code> 结尾的按目录刷新，其余按文件刷新（文件含查询参数自动忽略）。</p>
            <textarea
              value={urlText}
              onChange={(event) => setUrlText(event.target.value)}
              rows={5}
              placeholder={'https://hlydwz.com/stats/\nhttps://hlydwz.com/posts/'}
              className={cn(INPUT, 'font-mono leading-relaxed')}
            />
            {urlPreview.valid.length + urlPreview.invalid.length > 0 && (
              <div className="mt-2 space-y-1 text-xs">
                {urlPreview.valid.length > 0 && (
                  <div className="text-[var(--sf-ink-2)]">
                    识别 <span className="font-semibold text-[var(--sf-ink)]">{urlPreview.valid.length}</span> 条：
                    文件 <span className="font-mono">{urlPreview.files}</span> 条 / 目录 <span className="font-mono">{urlPreview.directories}</span> 条
                  </div>
                )}
                {urlPreview.invalid.map((line) => (
                  <div key={line} className="truncate rounded-[2px] border border-[var(--sf-danger)] px-2 py-1 font-mono text-[var(--sf-danger)]">格式不合法：{line}</div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => setConfirmUrlsOpen(true)}
              disabled={purgeDisabled || urlPreview.valid.length === 0 || urlPreview.invalid.length > 0}
              className={cn(BTN_BASE, BTN_PRIMARY, 'mt-3 min-h-10 px-4 text-sm')}
            >
              {purging ? '提交中…' : '刷新指定路径'}
            </button>
          </div>
        </div>
      </section>

      {/* 刷新记录 */}
      <section className={PANEL}>
        <div className={PANEL_HEAD}>
          <h2 className="text-sm font-semibold tracking-tight text-[var(--sf-ink)]">刷新记录</h2>
          <span className={HAIRLINE} aria-hidden="true" />
          <button
            type="button"
            onClick={() => void refreshTasks()}
            className={cn(BTN_BASE, BTN_SECONDARY, 'min-h-8 px-3 text-xs')}
          >
            刷新列表
          </button>
        </div>
        <div className={PANEL_BODY}>
          {tasks.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--sf-ink-3)]">EMPTY / 0</p>
              <p className="text-sm text-[var(--sf-ink-3)]">暂无刷新记录</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                <thead>
                  <tr className={TABLE_HEAD}>
                    <th scope="col" className={TH}>时间</th>
                    <th scope="col" className={TH}>类型</th>
                    <th scope="col" className={TH}>条数</th>
                    <th scope="col" className={TH}>TaskId</th>
                    <th scope="col" className={TH}>状态</th>
                    <th scope="col" className={TH}>备注</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task) => {
                    const meta = STATUS_META[task.status] || STATUS_META.submitted;
                    return (
                      <tr key={task.id} className={TABLE_ROW}>
                        <td className="whitespace-nowrap px-2 py-2 font-mono text-xs text-[var(--sf-ink-3)]">{formatTime(task.created)}</td>
                        <td className="px-2 py-2 text-[var(--sf-ink)]">{TYPE_LABELS[task.type] || task.type}</td>
                        <td className="px-2 py-2 font-mono text-xs text-[var(--sf-ink-2)]">{task.type === 'purgeall' ? '全部' : task.content.length}</td>
                        <td className="px-2 py-2 font-mono text-xs text-[var(--sf-ink-2)]">{task.taskId || '-'}</td>
                        <td className="px-2 py-2">
                          <span className={cn(CHIP, meta.tone)}>{meta.label}</span>
                        </td>
                        <td className="max-w-[200px] truncate px-2 py-2 text-xs text-[var(--sf-ink-3)]" title={task.message}>{task.message || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <ConfirmDialog
        open={confirmAllOpen}
        title="确认全站刷新？"
        message="将清除整个站点在 ESA 边缘节点上的全部缓存，所有访客的下一次请求都会回源，可能短时增加源站压力。建议在部署发布后执行。"
        confirmLabel="确认全站刷新"
        danger
        onConfirm={() => void handlePurgeAll()}
        onCancel={() => setConfirmAllOpen(false)}
      />
      <ConfirmDialog
        open={confirmUrlsOpen}
        title="确认刷新指定路径？"
        message={`将刷新 ${urlPreview.valid.length} 条地址（文件 ${urlPreview.files} 条 / 目录 ${urlPreview.directories} 条）的边缘缓存。`}
        confirmLabel="确认刷新"
        onConfirm={() => void handlePurgeUrls()}
        onCancel={() => setConfirmUrlsOpen(false)}
      />
    </div>
  );
}
