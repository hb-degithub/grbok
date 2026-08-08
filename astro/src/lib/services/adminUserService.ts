import { BaseService } from './baseService';
import type { RecordModel } from 'pocketbase';

export interface AdminUser {
  id: string;
  email: string;
  name?: string;
  avatar?: string;
  role: 'reader' | 'author' | 'admin' | 'super_admin';
  verified: boolean;
  created: string;
  updated: string;
}

type UserRecord = AdminUser & RecordModel;

class AdminUserService extends BaseService<UserRecord> {
  constructor() {
    super('users');
  }

  async getUsers(page = 1, perPage = 20): Promise<{ items: AdminUser[]; totalItems: number }> {
    const result = await this.getList(page, perPage, {
      sort: '-created',
    });
    return {
      items: result.items as unknown as AdminUser[],
      totalItems: result.totalItems,
    };
  }

  async getUserById(id: string): Promise<AdminUser | null> {
    try {
      const record = await this.getOne(id);
      return record as unknown as AdminUser;
    } catch {
      return null;
    }
  }

  async updateUserRole(id: string, role: AdminUser['role']): Promise<void> {
    await this.update(id, { role });
  }

  async deleteUser(id: string): Promise<void> {
    await this.delete(id);
  }

  async createUser(data: { email: string; password: string; passwordConfirm: string; name?: string; role?: string }): Promise<AdminUser> {
    const record = await this.create(data as unknown as Partial<UserRecord>);
    return record as unknown as AdminUser;
  }
}

export const adminUserService = new AdminUserService();
