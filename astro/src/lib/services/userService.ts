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
  notify_comment_reply?: boolean;
  notify_post_comment?: boolean;
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

  /**
   * 获取当前用户通知偏好
   */
  getNotificationPreferences(): { notify_comment_reply: boolean; notify_post_comment: boolean } {
    const pb = this.getPocketBase();
    const record = pb.authStore.record;
    return {
      notify_comment_reply: record?.notify_comment_reply !== false,
      notify_post_comment: record?.notify_post_comment !== false,
    };
  }

  /**
   * 更新当前用户通知偏好
   */
  async updateNotificationPreferences(prefs: { notify_comment_reply?: boolean; notify_post_comment?: boolean }): Promise<{ success: boolean; error?: unknown }> {
    try {
      const pb = this.getPocketBase();
      if (!pb.authStore.record?.id) {
        throw new Error('用户未登录');
      }
      await pb.collection('users').update(pb.authStore.record.id, prefs);
      return { success: true };
    } catch (err) {
      console.error('更新通知偏好失败:', err);
      return { success: false, error: err };
    }
  }
}

export const userService = new UserService();
