import { useState, useEffect, useCallback } from 'react';
import { auditLogService, type AuditLog, type AuditLogFilter } from '../../lib/services/auditLogService';

export function useAuditLogs(initialPage: number = 1, perPage: number = 20) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(initialPage);
  const [totalPages, setTotalPages] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const [filter, setFilter] = useState<AuditLogFilter>({});

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const result = await auditLogService.getLogs(page, perPage, filter);
      setLogs(result.items);
      setTotalPages(result.totalPages);
      setTotalItems(result.totalItems);
    } catch (err) {
      console.error('获取审计日志失败：', err);
    } finally {
      setLoading(false);
    }
  }, [page, perPage, filter]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const updateFilter = useCallback((newFilter: Partial<AuditLogFilter>) => {
    setFilter(prev => ({ ...prev, ...newFilter }));
    setPage(1);
  }, []);

  const clearFilter = useCallback(() => {
    setFilter({});
    setPage(1);
  }, []);

  return {
    logs,
    loading,
    page,
    totalPages,
    totalItems,
    filter,
    setPage,
    updateFilter,
    clearFilter,
    refresh: fetchLogs,
  };
}