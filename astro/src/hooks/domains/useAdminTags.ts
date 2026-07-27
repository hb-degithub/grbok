import { useState, useEffect, useCallback } from 'react';
import { adminTagService, type Tag } from '../../lib/services/adminTagService';
import { showToast } from '../../components/ui/Toast';
import { describePbError } from '../../lib/pb-error';
import { notifyStepUpExpired } from '../../lib/step-up-recovery';

export function useAdminTags() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Tag | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchTags = useCallback(async () => {
    setLoading(true);
    try {
      const result = await adminTagService.getTags(1, 100);
      setTags(result.items);
    } catch (err) {
      console.error('获取标签失败：', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  const saveTag = useCallback(async () => {
    if (!editing || !editing.name) return;
    setSaving(true);
    try {
      const data = {
        name: editing.name,
        slug: editing.slug || editing.name.toLowerCase().replace(/[^\w\u4e00-\u9fa5]/g, '-').replace(/-+/g, '-'),
        description: editing.description || '',
      };
      if (editing.id) {
        await adminTagService.updateTag(editing.id, data);
      } else {
        await adminTagService.createTag(data);
      }
      setEditing(null);
      fetchTags();
      showToast('标签保存成功', 'success');
    } catch (err) {
      console.error('保存标签失败：', err);
      if (notifyStepUpExpired(err)) {
        showToast('管理会话已过期，请重新验证动态口令', 'error');
        return;
      }
      showToast(describePbError(err, '保存失败'), 'error');
    } finally {
      setSaving(false);
    }
  }, [editing, fetchTags]);

  const deleteTag = useCallback(async (id: string) => {
    try {
      await adminTagService.deleteTag(id);
      fetchTags();
      showToast('标签已删除', 'success');
    } catch (err) {
      console.error('删除标签失败：', err);
      if (notifyStepUpExpired(err)) {
        showToast('管理会话已过期，请重新验证动态口令', 'error');
        return;
      }
      showToast(describePbError(err, '删除标签失败'), 'error');
    }
  }, [fetchTags]);

  return {
    tags,
    loading,
    editing,
    saving,
    setEditing,
    fetchTags,
    saveTag,
    deleteTag,
  };
}