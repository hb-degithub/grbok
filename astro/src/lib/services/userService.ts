import { BaseService } from './baseService';
import type { RecordModel } from 'pocketbase';
import { registerReader as registerReaderRequest, requestVerification as requestVerificationRequest } from '../blog-auth-client';

export interface ReaderRegisterData {
  email: string;
  name: string;
  password: string;
  passwordConfirm: string;
}

export interface User {
  id: string;
  email: string;
  name?: string;
  avatar?: string;
  role?: string;
  verified?: boolean;
  created: string;
  updated: string;
}

type UserRecord = User & RecordModel;

class UserService extends BaseService<UserRecord> {
  constructor() {
    super('users');
  }

  /**
   * 注册读者用户
   */
  async registerReader(data: ReaderRegisterData): Promise<{ success: boolean; error?: unknown }> {
    try {
      await registerReaderRequest(data);
      return { success: true };
    } catch (err) {
      console.error('注册 reader 用户失败:', err);
      return { success: false, error: err };
    }
  }

  /**
   * 请求邮箱验证
   */
  async requestVerification(email: string): Promise<{ success: boolean; error?: unknown }> {
    try {
      await requestVerificationRequest(email);
      return { success: true };
    } catch (err) {
      console.error('发送验证邮件失败:', err);
      return { success: false, error: err };
    }
  }

  /**
   * 检查是否已登录
   */
  isLoggedIn(): boolean {
    const pb = this.getPocketBase();
    return pb.authStore.isValid && !!pb.authStore.record;
  }
}

export const userService = new UserService();
