import { BaseService } from './baseService';
import type { RecordModel } from 'pocketbase';

export interface AuditLog {
  id: string;
  action: string;
  target_type: string;
  target_id?: string;
  actor?: string;
  actor_email?: string;
  actor_name?: string;
  details?: Record<string, unknown>;
  ip_address?: string;
  user_agent?: string;
  created: string;
  expand?: {
    actor?: {
      id: string;
      email: string;
      name?: string;
    };
  };
}

type AuditLogRecord = AuditLog & RecordModel;

export interface AuditLogFilter {
  action?: string;
  targetType?: string;
  query?: string;
}

class AuditLogService extends BaseService<AuditLogRecord> {
  constructor() {
    super('audit_logs');
  }

  async getLogs(page: number = 1, perPage: number = 20, filter?: AuditLogFilter) {
    const pb = this.getPocketBase();
    const filterParts: string[] = [];

    if (filter?.action) {
      filterParts.push(pb.filter('action = {:action}', { action: filter.action }));
    }
    if (filter?.targetType) {
      filterParts.push(pb.filter('target_type = {:targetType}', { targetType: filter.targetType }));
    }
    if (filter?.query) {
      filterParts.push(
        pb.filter('target_id ~ {:query} || details ~ {:query}', { query: filter.query })
      );
    }

    const filterString = filterParts.length > 0 ? filterParts.join(' && ') : undefined;

    return this.getList(page, perPage, {
      sort: '-created',
      expand: 'actor',
      filter: filterString,
    });
  }

  async getLogById(id: string) {
    return this.getOne(id, { expand: 'actor' });
  }
}

export const auditLogService = new AuditLogService();