import { BaseService } from './baseService';
import type { RecordModel } from 'pocketbase';

export interface SeriesEntry {
  slug: string;
  title: string;
  order: number;
}

export interface Setting {
  id: string;
  key: string;
  value: unknown;
  created: string;
  updated: string;
}

type SettingRecord = Setting & RecordModel;

class SeriesService extends BaseService<SettingRecord> {
  constructor() {
    super('settings');
  }

  /**
   * 获取系列文章列表
   */
  async getSeriesEntries(seriesId: string): Promise<SeriesEntry[]> {
    const pb = this.getPocketBase();
    try {
      const record = await pb.collection('settings').getFirstListItem(
        pb.filter('key = {:key}', { key: `series:${seriesId}` })
      );
      const stored = record.value as SeriesEntry[] | string;
      const list: SeriesEntry[] = typeof stored === 'string' ? JSON.parse(stored || '[]') : (stored || []);
      return list.sort((a, b) => (a.order || 0) - (b.order || 0));
    } catch {
      return [];
    }
  }
}

export const seriesService = new SeriesService();
