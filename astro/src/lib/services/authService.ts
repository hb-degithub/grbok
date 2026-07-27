import { BaseService } from './baseService';
import type { RecordModel } from 'pocketbase';

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

export interface AuthResponse {
  token: string;
  record: User;
}

class AuthService extends BaseService<UserRecord> {
  constructor() {
    super('users');
  }

  /**
   * 使用邮箱和密码登录
   */
  async loginWithPassword(email: string, password: string): Promise<AuthResponse> {
    const pb = this.getPocketBase();
    const authData = await pb.collection('users').authWithPassword(email, password);
    return {
      token: authData.token,
      record: authData.record as unknown as User,
    };
  }

  /**
   * 确认邮箱验证
   */
  async confirmVerification(token: string): Promise<void> {
    const pb = this.getPocketBase();
    await pb.collection('users').confirmVerification(token);
  }

  /**
   * 刷新认证状态
   */
  async refreshAuth(): Promise<AuthResponse> {
    const pb = this.getPocketBase();
    const authData = await pb.collection('users').authRefresh();
    return {
      token: authData.token,
      record: authData.record as unknown as User,
    };
  }

  /**
   * 请求密码重置
   */
  async requestPasswordReset(email: string): Promise<void> {
    const pb = this.getPocketBase();
    await pb.collection('users').requestPasswordReset(email);
  }

  /**
   * 确认密码重置
   */
  async confirmPasswordReset(token: string, password: string, passwordConfirm: string): Promise<void> {
    const pb = this.getPocketBase();
    await pb.collection('users').confirmPasswordReset(token, password, passwordConfirm);
  }

  /**
   * 请求邮箱验证
   */
  async requestVerification(email: string): Promise<void> {
    const pb = this.getPocketBase();
    await pb.collection('users').requestVerification(email);
  }

  /**
   * 检查是否已认证
   */
  isAuthenticated(): boolean {
    const pb = this.getPocketBase();
    return pb.authStore.isValid;
  }

  /**
   * 获取当前用户
   */
  getCurrentUser(): User | null {
    const pb = this.getPocketBase();
    return pb.authStore.model as unknown as User | null;
  }

  /**
   * 登出
   */
  logout(): void {
    const pb = this.getPocketBase();
    pb.authStore.clear();
  }

  /**
   * 获取当前登录用户的邮箱验证状态
   * @returns 已验证返回 true，未验证返回 false，未登录返回 undefined
   */
  getUserEmailVerified(): boolean | undefined {
    const pb = this.getPocketBase();
    if (pb.authStore.isValid && pb.authStore.record) {
      return !!(pb.authStore.record as any).verified;
    }
    return undefined;
  }

  /**
   * 获取当前登录用户的邮箱
   */
  getUserEmail(): string | undefined {
    const pb = this.getPocketBase();
    return pb.authStore.record?.email;
  }

  /**
   * 监听认证状态变化
   */
  onAuthChange(callback: () => void): () => void {
    const pb = this.getPocketBase();
    return pb.authStore.onChange(callback);
  }
}

export const authService = new AuthService();
