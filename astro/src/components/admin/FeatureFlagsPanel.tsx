import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useFeatureFlags } from '../../hooks/domains/useFeatureFlags';
import type { FeatureFlag } from '../../lib/services/featureFlagService';

/* 功能开关（科幻简约 · 批次 C5）
   面板与弹窗都是 surface 底 + 冷灰细线，圆角 3px；开关用 2px 方角轨道（开启=唯一强调色）。
   输入与 ui/Input.tsx 同一套。新建/编辑/启用/删除、window.confirm 与 saveFlag 逻辑保持不变。 */

interface FlagFormData {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
}

const defaultFormData: FlagFormData = {
  key: '',
  name: '',
  description: '',
  enabled: false,
};

const LABEL = 'mb-1.5 block font-mono text-[11px] tracking-[0.08em] text-[var(--sf-ink-3)]';
const INPUT =
  'min-h-[40px] w-full min-w-0 rounded-[3px] border border-[var(--sf-line-control)] bg-[var(--sf-surface)] px-3 py-2.5 text-[16px] leading-snug text-[var(--sf-ink)] outline-none transition-colors placeholder:text-[var(--sf-ink-3)] focus-visible:border-[var(--sf-accent)] focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)] disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm';
const BTN_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-[3px] border font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)] disabled:cursor-not-allowed disabled:opacity-50';
const BTN_PRIMARY = 'border-[var(--sf-accent)] bg-[var(--sf-accent)] text-[var(--sf-on-accent)] hover:border-[var(--sf-accent-ink)] hover:bg-[var(--sf-accent-ink)]';
const BTN_SECONDARY = 'border-[var(--sf-line-control)] bg-[var(--sf-surface)] text-[var(--sf-ink-2)] hover:border-[var(--sf-line-strong)] hover:text-[var(--sf-ink)]';
const BTN_DANGER = 'border-[var(--sf-danger)] bg-[var(--sf-surface)] text-[var(--sf-danger)] hover:bg-[var(--sf-danger)] hover:text-[var(--sf-on-accent)]';

/** 开关：轨道 2px 方角，开启 accent 实底 + on-accent 滑块，关闭 canvas 底 + 控制线滑块。 */
function Switch({ checked, onToggle, label }: { checked: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`inline-flex h-5 w-9 shrink-0 items-center rounded-[2px] border px-[3px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)] ${
        checked ? 'justify-end border-[var(--sf-accent)] bg-[var(--sf-accent)]' : 'justify-start border-[var(--sf-line-control)] bg-[var(--sf-canvas)]'
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-3.5 w-3.5 rounded-[1px] transition-colors ${
          checked ? 'bg-[var(--sf-on-accent)]' : 'bg-[var(--sf-ink-3)]'
        }`}
      />
    </button>
  );
}

function FlagModal({
  flag,
  onClose,
  onSave,
  saving,
}: {
  flag: FeatureFlag | null;
  onClose: () => void;
  onSave: (data: FlagFormData) => Promise<boolean>;
  saving: boolean;
}) {
  const [formData, setFormData] = useState<FlagFormData>(
    flag
      ? { key: flag.key, name: flag.name, description: flag.description || '', enabled: flag.enabled }
      : defaultFormData
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const success = await onSave(formData);
    if (success) {
      onClose();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--sf-scrim)] p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="flag-dialog-title"
        className="w-full max-w-md rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3 border-b border-[var(--sf-line)] pb-3">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--sf-ink-3)]">{flag ? 'EDIT' : 'NEW'}</p>
            <h3 id="flag-dialog-title" className="mt-0.5 break-words text-sm font-semibold tracking-tight text-[var(--sf-ink)] [overflow-wrap:anywhere]">{flag ? '编辑功能开关' : '新建功能开关'}</h3>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭对话框"
            className="shrink-0 rounded-[3px] border border-transparent p-1 text-[var(--sf-ink-3)] transition-colors hover:border-[var(--sf-line)] hover:bg-[var(--sf-line-soft)] hover:text-[var(--sf-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)]"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="flag-key" className={LABEL}>
              开关标识
            </label>
            <input
              id="flag-key"
              type="text"
              value={formData.key}
              onChange={(e) => setFormData({ ...formData, key: e.target.value })}
              placeholder="feature_key"
              required
              disabled={!!flag}
              className={`${INPUT} font-mono`}
            />
            <p className="mt-1 text-xs text-[var(--sf-ink-3)]">唯一标识符，创建后不可修改</p>
          </div>

          <div>
            <label htmlFor="flag-name" className={LABEL}>
              显示名称
            </label>
            <input
              id="flag-name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="功能名称"
              required
              className={INPUT}
            />
          </div>

          <div>
            <label htmlFor="flag-description" className={LABEL}>
              描述
            </label>
            <textarea
              id="flag-description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="功能描述..."
              rows={3}
              className={INPUT}
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setFormData({ ...formData, enabled: !formData.enabled })}
              role="switch"
              aria-checked={formData.enabled}
              aria-label={formData.enabled ? '禁用开关' : '启用开关'}
              className={`inline-flex h-6 w-11 shrink-0 items-center rounded-[2px] border px-[3px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)] ${
                formData.enabled ? 'justify-end border-[var(--sf-accent)] bg-[var(--sf-accent)]' : 'justify-start border-[var(--sf-line-control)] bg-[var(--sf-canvas)]'
              }`}
            >
              <span
                aria-hidden="true"
                className={`inline-block h-5 w-5 rounded-[1px] transition-colors ${
                  formData.enabled ? 'bg-[var(--sf-on-accent)]' : 'bg-[var(--sf-line-control)]'
                }`}
              />
            </button>
            <span className="text-sm text-[var(--sf-ink)]">{formData.enabled ? '已启用' : '已禁用'}</span>
          </div>

          <div className="flex justify-end gap-3 border-t border-[var(--sf-line)] pt-3">
            <button
              type="button"
              onClick={onClose}
              className={`${BTN_BASE} min-h-10 px-4 text-sm ${BTN_SECONDARY}`}
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className={`${BTN_BASE} min-h-10 px-4 text-sm ${BTN_PRIMARY}`}
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

export default function FeatureFlagsPanel() {
  const { flags, loading, saving, saveFlag, toggleFlag, deleteFlag } = useFeatureFlags();
  const [showModal, setShowModal] = useState(false);
  const [editingFlag, setEditingFlag] = useState<FeatureFlag | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  const handleEdit = (flag: FeatureFlag) => {
    setEditingFlag(flag);
    setShowModal(true);
  };

  const handleCreate = () => {
    setEditingFlag(null);
    setShowModal(true);
  };

  const handleDelete = async (key: string) => {
    if (!confirm('确定要删除这个功能开关吗？')) return;
    setDeletingKey(key);
    await deleteFlag(key);
    setDeletingKey(null);
  };

  const handleSave = async (data: FlagFormData) => {
    return saveFlag(data);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-w-0 space-y-4">
      <section className="min-w-0 overflow-hidden rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)]">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--sf-line)] px-4 py-3">
          <div className="min-w-0">
            <h2 className="break-words text-sm font-semibold tracking-tight text-[var(--sf-ink)] [overflow-wrap:anywhere]">功能开关</h2>
            <p className="mt-1 break-words text-xs text-[var(--sf-ink-3)] [overflow-wrap:anywhere]">控制网站功能的启用和禁用。</p>
          </div>
          <button
            onClick={handleCreate}
            className={`${BTN_BASE} min-h-10 px-4 text-xs ${BTN_PRIMARY}`}
          >
            新建开关
          </button>
        </div>

        {loading ? (
          <div className="divide-y divide-[var(--sf-line-soft)]" aria-hidden="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse bg-[var(--sf-canvas)]" />
            ))}
          </div>
        ) : flags.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 px-4 py-10 text-center">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--sf-ink-3)]">EMPTY / 0</p>
            <p className="text-sm text-[var(--sf-ink-2)]">暂无功能开关</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--sf-line-soft)]">
            {flags.map((flag) => (
              <div
                key={flag.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-[var(--sf-canvas)]"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="break-all font-mono text-sm font-medium text-[var(--sf-ink)] [overflow-wrap:anywhere]">{flag.key}</span>
                    <Switch
                      checked={!!flag.enabled}
                      onToggle={() => toggleFlag(flag.key, !flag.enabled)}
                      label={`${flag.name}：${flag.enabled ? '已启用' : '已禁用'}`}
                    />
                  </div>
                  <p className="mt-1 break-words text-sm text-[var(--sf-ink-2)] [overflow-wrap:anywhere]">{flag.name}</p>
                  {flag.description && (
                    <p className="mt-1 break-words text-xs text-[var(--sf-ink-3)] [overflow-wrap:anywhere]">{flag.description}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => handleEdit(flag)}
                    className={`${BTN_BASE} min-h-8 px-3 text-xs ${BTN_SECONDARY}`}
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => handleDelete(flag.key)}
                    disabled={deletingKey === flag.key}
                    className={`${BTN_BASE} min-h-8 px-3 text-xs ${BTN_DANGER}`}
                  >
                    {deletingKey === flag.key ? '删除中...' : '删除'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <AnimatePresence>
        {showModal && (
          <FlagModal
            flag={editingFlag}
            onClose={() => setShowModal(false)}
            onSave={handleSave}
            saving={saving}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
