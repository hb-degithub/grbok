import { BaseService } from './baseService';
import type { RecordModel } from 'pocketbase';

export interface FeatureFlag {
  id: string;
  key: string;
  name: string;
  description?: string;
  enabled: boolean;
  created: string;
  updated: string;
}

type FeatureFlagRecord = FeatureFlag & RecordModel;

class FeatureFlagService extends BaseService<FeatureFlagRecord> {
  constructor() {
    super('feature_flags');
  }

  async getFlags(): Promise<FeatureFlag[]> {
    const records = await this.getFullList({
      sort: 'key',
    });
    return records as unknown as FeatureFlag[];
  }

  async getFlag(key: string): Promise<FeatureFlag | null> {
    const pb = this.getPocketBase();
    try {
      const record = await pb.collection('feature_flags').getFirstListItem(
        pb.filter('key = {:key}', { key })
      );
      return record as unknown as FeatureFlag;
    } catch {
      return null;
    }
  }

  async setFlag(key: string, enabled: boolean): Promise<void> {
    const pb = this.getPocketBase();
    try {
      const existing = await pb.collection('feature_flags').getFirstListItem(
        pb.filter('key = {:key}', { key })
      );
      await pb.collection('feature_flags').update(existing.id, { enabled });
    } catch {
      await pb.collection('feature_flags').create({ key, enabled, name: key });
    }
  }

  async createFlag(data: Omit<FeatureFlag, 'id' | 'created' | 'updated'>): Promise<FeatureFlag> {
    const record = await this.create(data);
    return record as unknown as FeatureFlag;
  }

  async updateFlag(id: string, data: Partial<FeatureFlag>): Promise<FeatureFlag> {
    const record = await this.update(id, data);
    return record as unknown as FeatureFlag;
  }

  async deleteFlag(id: string): Promise<void> {
    await this.delete(id);
  }

  async isEnabled(key: string): Promise<boolean> {
    const flag = await this.getFlag(key);
    return flag?.enabled ?? false;
  }
}

export const featureFlagService = new FeatureFlagService();
