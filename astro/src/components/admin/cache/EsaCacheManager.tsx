import React, { useMemo, useState } from 'react';
import ConfirmDialog from '../../ui/ConfirmDialog';
import { useEsaCache } from '../../../hooks/domains/useEsaCache';
import { cn } from '../../../lib/utils';

const STATUS_META: Record<string, { label: string; tone: string }> = {
  submitted: { label: '执行中', tone: 'border-accent/25 bg-accent/10 text-accent' },
  complete: { label: '已完成', tone: 'border-success/25 bg-success/10 text-success' },
  failed: { label: '失败', tone: 'border-danger/25 bg-danger/10 text-danger' },
  rejected: { label: '已拒绝', tone: 'border-warning/25 bg-warning/10 text-warning' },
};

const TYPE_LABELS: Record<string, string> = {
  purgeall: '全站',
  file: '文件',
  directory: '目录',
};

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
    <div className="mx-auto max-w-5xl space-y-6">
      <p className="text-sm text-text-secondary">通过阿里云 ESA OpenAPI 刷新边缘缓存，部署后用于清理边缘节点上的过期页面。</p>

      {error && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-danger/25 bg-danger/10 px-4 py-3 text-sm text-danger">
          <span>{error}</span>
          <button type="button" onClick={dismissMessages} className="shrink-0 text-danger/70 hover:text-danger" aria-label="关闭错误提示">✕</button>
        </div>
      )}
      {notice && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-success/25 bg-success/10 px-4 py-3 text-sm text-success">
          <span>{notice}</span>
          <button type="button" onClick={dismissMessages} className="shrink-0 text-success/70 hover:text-success" aria-label="关闭提示">✕</button>
        </div>
      )}

      {/* 凭证配置 */}
      <section className="rounded-xl border border-border bg-white p-5 shadow-xs">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-text">ESA API 凭证</h2>
          {config && (
            <span className={cn(
              'rounded-md border px-2 py-0.5 font-mono text-[11px]',
              configured && configEnabled
                ? 'border-success/25 bg-success/10 text-success'
                : configured
                  ? 'border-warning/25 bg-warning/10 text-warning'
                  : 'border-border bg-bg-soft text-muted',
            )}>
              {configured ? (configEnabled ? '已启用' : '已配置未启用') : '未配置'}
            </span>
          )}
        </div>
        {loading ? (
          <div className="h-24 animate-pulse rounded-lg bg-bg-soft" />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-text-secondary">AccessKey ID</span>
              <input
                type="text"
                value={accessKeyId}
                onChange={(event) => setAccessKeyId(event.target.value)}
                placeholder={config?.hasSecret ? config.accessKeyId : 'LTAI...'}
                autoComplete="off"
                className="w-full rounded-lg border border-border bg-bg-soft px-3 py-2 font-mono text-sm text-text outline-none transition-colors focus:border-accent"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-text-secondary">AccessKey Secret{config?.hasSecret && '（留空表示不修改）'}</span>
              <input
                type="password"
                value={accessKeySecret}
                onChange={(event) => setAccessKeySecret(event.target.value)}
                placeholder={config?.hasSecret ? '已保存，留空保持不变' : '输入 AccessKey Secret'}
                autoComplete="new-password"
                className="w-full rounded-lg border border-border bg-bg-soft px-3 py-2 font-mono text-sm text-text outline-none transition-colors focus:border-accent"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-text-secondary">ESA 站点 ID（SiteId）</span>
              <input
                type="text"
                inputMode="numeric"
                value={siteId}
                onChange={(event) => setSiteId(event.target.value.replace(/[^0-9]/g, ''))}
                placeholder="ESA 控制台站点信息中的数字 ID"
                className="w-full rounded-lg border border-border bg-bg-soft px-3 py-2 font-mono text-sm text-text outline-none transition-colors focus:border-accent"
              />
            </label>
            <label className="flex items-end gap-2 pb-2">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
                className="h-4 w-4 rounded border-border accent-[var(--color-accent)]"
              />
              <span className="text-sm text-text">启用 ESA 缓存刷新</span>
            </label>
            <div className="md:col-span-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !accessKeyId.trim() || !siteId}
                className="rounded-lg bg-text px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? '保存中…' : '保存配置'}
              </button>
              <p className="mt-2 text-xs text-muted">Secret 加密后存储，任何接口均不回传明文。建议使用仅授权 ESA 刷新权限的 RAM 子账号。</p>
            </div>
          </div>
        )}
      </section>

      {/* 刷新操作 */}
      <section className="rounded-xl border border-border bg-white p-5 shadow-xs">
        <h2 className="mb-4 text-base font-bold text-text">刷新缓存</h2>
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-danger/20 bg-danger/5 p-4">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-text">全站刷新</div>
              <p className="mt-0.5 text-xs text-text-secondary">清除整个站点在 ESA 边缘节点上的全部缓存。部署发布后使用，会短时增加源站回源压力。</p>
            </div>
            <button
              type="button"
              onClick={() => setConfirmAllOpen(true)}
              disabled={purgeDisabled}
              className="shrink-0 rounded-lg border border-danger/40 bg-danger px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {purging ? '提交中…' : '全站刷新'}
            </button>
          </div>

          <div>
            <div className="mb-1 text-sm font-semibold text-text">自定义路径刷新</div>
            <p className="mb-2 text-xs text-text-secondary">每行一个本站完整 URL。以 <code className="rounded bg-bg-soft px-1 font-mono">/</code> 结尾的按目录刷新，其余按文件刷新（文件含查询参数自动忽略）。</p>
            <textarea
              value={urlText}
              onChange={(event) => setUrlText(event.target.value)}
              rows={5}
              placeholder={'https://hlydwz.com/stats/\nhttps://hlydwz.com/posts/'}
              className="w-full rounded-lg border border-border bg-bg-soft px-3 py-2 font-mono text-sm text-text outline-none transition-colors focus:border-accent"
            />
            {urlPreview.valid.length + urlPreview.invalid.length > 0 && (
              <div className="mt-2 space-y-1 text-xs">
                {urlPreview.valid.length > 0 && (
                  <div className="text-text-secondary">
                    识别 <span className="font-semibold text-text">{urlPreview.valid.length}</span> 条：
                    文件 <span className="font-mono">{urlPreview.files}</span> 条 / 目录 <span className="font-mono">{urlPreview.directories}</span> 条
                  </div>
                )}
                {urlPreview.invalid.map((line) => (
                  <div key={line} className="truncate rounded border border-danger/20 bg-danger/5 px-2 py-1 font-mono text-danger">格式不合法：{line}</div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => setConfirmUrlsOpen(true)}
              disabled={purgeDisabled || urlPreview.valid.length === 0 || urlPreview.invalid.length > 0}
              className="mt-3 rounded-lg bg-text px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {purging ? '提交中…' : '刷新指定路径'}
            </button>
          </div>
        </div>
      </section>

      {/* 刷新记录 */}
      <section className="rounded-xl border border-border bg-white p-5 shadow-xs">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-text">刷新记录</h2>
          <button
            type="button"
            onClick={() => void refreshTasks()}
            className="rounded-lg border border-border bg-bg-soft px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-white hover:text-text"
          >
            刷新列表
          </button>
        </div>
        {tasks.length === 0 ? (
          <div className="rounded-lg bg-bg-soft px-4 py-8 text-center text-sm text-muted">暂无刷新记录</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-border font-mono text-[11px] uppercase text-muted">
                  <th className="px-2 py-2">时间</th>
                  <th className="px-2 py-2">类型</th>
                  <th className="px-2 py-2">条数</th>
                  <th className="px-2 py-2">TaskId</th>
                  <th className="px-2 py-2">状态</th>
                  <th className="px-2 py-2">备注</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => {
                  const meta = STATUS_META[task.status] || STATUS_META.submitted;
                  return (
                    <tr key={task.id} className="border-b border-border/60 last:border-0">
                      <td className="whitespace-nowrap px-2 py-2 font-mono text-xs text-text-secondary">{formatTime(task.created)}</td>
                      <td className="px-2 py-2 text-text">{TYPE_LABELS[task.type] || task.type}</td>
                      <td className="px-2 py-2 font-mono text-xs text-text-secondary">{task.type === 'purgeall' ? '全部' : task.content.length}</td>
                      <td className="px-2 py-2 font-mono text-xs text-text-secondary">{task.taskId || '-'}</td>
                      <td className="px-2 py-2">
                        <span className={cn('inline-flex rounded-md border px-2 py-0.5 font-mono text-[11px]', meta.tone)}>{meta.label}</span>
                      </td>
                      <td className="max-w-[200px] truncate px-2 py-2 text-xs text-muted" title={task.message}>{task.message || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
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
