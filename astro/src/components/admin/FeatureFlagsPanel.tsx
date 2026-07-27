import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useFeatureFlags } from '../../hooks/domains/useFeatureFlags';
import type { FeatureFlag } from '../../lib/services/featureFlagService';

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <h3 className="text-lg font-bold text-text">{flag ? '编辑功能开关' : '新建功能开关'}</h3>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-text-secondary hover:bg-bg-soft hover:text-text"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block font-mono text-xs uppercase tracking-wide text-text-secondary">
              开关标识
            </label>
            <input
              type="text"
              value={formData.key}
              onChange={(e) => setFormData({ ...formData, key: e.target.value })}
              placeholder="feature_key"
              required
              disabled={!!flag}
              className="min-h-10 w-full min-w-0 rounded-md border border-border bg-bg-soft px-3 py-2.5 font-mono text-sm text-text outline-none focus:border-accent focus:bg-white disabled:opacity-60"
            />
            <p className="mt-1 text-xs text-text-secondary">唯一标识符，创建后不可修改</p>
          </div>

          <div>
            <label className="mb-1.5 block font-mono text-xs uppercase tracking-wide text-text-secondary">
              显示名称
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="功能名称"
              required
              className="min-h-10 w-full min-w-0 rounded-md border border-border bg-bg-soft px-3 py-2.5 text-sm text-text outline-none focus:border-accent focus:bg-white"
            />
          </div>

          <div>
            <label className="mb-1.5 block font-mono text-xs uppercase tracking-wide text-text-secondary">
              描述
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="功能描述..."
              rows={3}
              className="min-h-10 w-full min-w-0 rounded-md border border-border bg-bg-soft px-3 py-2.5 text-sm text-text outline-none focus:border-accent focus:bg-white"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setFormData({ ...formData, enabled: !formData.enabled })}
              className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${
                formData.enabled ? 'border-accent bg-accent' : 'border-border bg-bg-soft'
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                  formData.enabled ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
            <span className="text-sm text-text">{formData.enabled ? '已启用' : '已禁用'}</span>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border bg-white px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-bg-soft"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="btn-primary rounded-md px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
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
      <section className="card rounded-md p-4 shadow-xs">
        <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
          <div>
            <h2 className="break-words text-sm font-black text-text">功能开关</h2>
            <p className="mt-1 break-words text-xs text-text-secondary">控制网站功能的启用和禁用。</p>
          </div>
          <button
            onClick={handleCreate}
            className="btn-primary min-h-10 rounded-md px-4 text-xs"
          >
            新建开关
          </button>
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-md bg-bg-soft" />
            ))}
          </div>
        ) : flags.length === 0 ? (
          <div className="py-8 text-center text-sm text-text-secondary">暂无功能开关</div>
        ) : (
          <div className="space-y-3">
            {flags.map((flag) => (
              <div
                key={flag.id}
                className="flex items-center justify-between rounded-md border border-border bg-white p-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-medium text-text">{flag.key}</span>
                    <button
                      onClick={() => toggleFlag(flag.key, !flag.enabled)}
                      className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${
                        flag.enabled ? 'border-success bg-success' : 'border-border bg-bg-soft'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                          flag.enabled ? 'translate-x-4' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>
                  <p className="mt-1 text-sm text-text">{flag.name}</p>
                  {flag.description && (
                    <p className="mt-1 text-xs text-text-secondary">{flag.description}</p>
                  )}
                </div>
                <div className="ml-4 flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => handleEdit(flag)}
                    className="rounded-md border border-border bg-white px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-soft hover:text-text"
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => handleDelete(flag.key)}
                    disabled={deletingKey === flag.key}
                    className="rounded-md border border-error/25 bg-error/10 px-3 py-1.5 text-xs text-error transition-colors hover:bg-error/20 disabled:opacity-50"
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
