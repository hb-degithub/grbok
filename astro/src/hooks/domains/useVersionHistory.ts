import { useState, useEffect, useCallback } from 'react';
import { versionHistoryService, type PostVersion, type Post } from '../../lib/services/versionHistoryService';
import { showToast } from '../../components/ui/Toast';

export function useVersionHistory() {
  const [versions, setVersions] = useState<PostVersion[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [selectedPost, setSelectedPost] = useState('');
  const [loading, setLoading] = useState(true);
  const [compareLeft, setCompareLeft] = useState<string | null>(null);
  const [compareRight, setCompareRight] = useState<string | null>(null);

  const loadPosts = useCallback(async () => {
    try {
      const data = await versionHistoryService.getPosts();
      setPosts(data);
    } catch (err) {
      console.error('Failed to load posts:', err);
      showToast('加载文章列表失败', 'error');
    }
  }, []);

  const loadVersions = useCallback(async () => {
    setLoading(true);
    try {
      const result = await versionHistoryService.getVersions(selectedPost || undefined);
      setVersions(result.items);
    } catch (err) {
      console.error('Failed to load versions:', err);
      showToast('加载版本历史失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedPost]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  useEffect(() => {
    loadVersions();
  }, [loadVersions]);

  const toggleCompare = useCallback((id: string) => {
    if (compareLeft === id) {
      setCompareLeft(null);
    } else if (compareRight === id) {
      setCompareRight(null);
    } else if (!compareLeft) {
      setCompareLeft(id);
    } else if (!compareRight) {
      setCompareRight(id);
    } else {
      showToast('最多只能选择两个版本进行对比', 'warning');
    }
  }, [compareLeft, compareRight]);

  const clearCompare = useCallback(() => {
    setCompareLeft(null);
    setCompareRight(null);
  }, []);

  const getCompareVersions = useCallback(async () => {
    if (!compareLeft || !compareRight) return null;
    try {
      return await versionHistoryService.compareVersions(compareLeft, compareRight);
    } catch (err) {
      console.error('Failed to compare versions:', err);
      showToast('获取对比数据失败', 'error');
      return null;
    }
  }, [compareLeft, compareRight]);

  return {
    versions,
    posts,
    selectedPost,
    setSelectedPost,
    loading,
    compareLeft,
    compareRight,
    toggleCompare,
    clearCompare,
    getCompareVersions,
    refresh: loadVersions,
  };
}