import { getPocketBase } from './pocketbase';
import { normalizeAuthEmail, withAuthRequestHeaders } from './security';
import type { ReaderRegisterData } from '../types/pocketbase';
import type { User } from '../types/pocketbase';
import type { RecordModel } from 'pocketbase';

export interface AcceptedResponse {
  accepted: true;
  code: 'REGISTRATION_SUBMITTED' | 'MAIL_REQUEST_ACCEPTED';
  referenceId: string;
  message?: string;
}

/**
 * `altcha` 是可选的 ALTCHA PoW payload（base64）。只有前端拿到验证结果时才带，
 * 未带时服务端会返回 CAPTCHA_REQUIRED 等错误码；字段可选保证既有调用与测试不变。
 */
export type RegisterInput = Omit<ReaderRegisterData, 'role'> & { inviteCode?: string; altcha?: string };

export async function registerReader(input: RegisterInput): Promise<AcceptedResponse> {
  const pb = getPocketBase();
  return withAuthRequestHeaders(pb, () => pb.send<AcceptedResponse>('/api/blog-auth/register', {
    method: 'POST',
    body: { ...input, email: input.email ? normalizeAuthEmail(input.email) : undefined },
  }));
}

export async function requestVerification(email: string, altcha?: string): Promise<AcceptedResponse> {
  const pb = getPocketBase();
  return withAuthRequestHeaders(pb, () => pb.send<AcceptedResponse>('/api/blog-auth/verification/request', {
    method: 'POST',
    // altcha 为 undefined 时 JSON 序列化会省略该字段
    body: { email: normalizeAuthEmail(email), altcha },
  }));
}

export interface ReaderOtpResponse extends AcceptedResponse { challengeId: string; expiresIn: number }
export interface AuthResponse { token: string; record: User }

export async function requestReaderOtp(email: string, altcha?: string): Promise<ReaderOtpResponse> {
  const pb = getPocketBase();
  return withAuthRequestHeaders(pb, () => pb.send<ReaderOtpResponse>('/api/blog-auth/otp/request', {
    method: 'POST',
    body: { email: normalizeAuthEmail(email), altcha },
  }));
}

export async function verifyReaderOtp(challengeId: string, code: string): Promise<AuthResponse> {
  const pb = getPocketBase();
  const result = await withAuthRequestHeaders(pb, () => pb.send<AuthResponse>('/api/blog-auth/otp/verify', { method: 'POST', body: { challengeId, code } }));
  pb.authStore.save(result.token, result.record as unknown as RecordModel);
  return result;
}

export interface MailRequestAcceptedResponse {
  accepted: true;
  code: 'MAIL_REQUEST_ACCEPTED';
  referenceId: string;
  message?: string;
  retryAfterSeconds?: number;
}

export interface DetailedRateLimitResponse {
  accepted: false;
  code: 'EMAIL_RATE_LIMITED' | 'IP_RATE_LIMITED' | 'GLOBAL_RATE_LIMITED' | 'REQUEST_RATE_LIMITED';
  referenceId: string;
  message?: string;
  retryAfterSeconds?: number;
}

export type AccountMailResponse = MailRequestAcceptedResponse | DetailedRateLimitResponse;

export function isAccountMailRateLimited(response: AccountMailResponse): response is DetailedRateLimitResponse {
  return response.accepted === false;
}

export async function requestPasswordReset(email: string, altcha?: string): Promise<AccountMailResponse> {
  const pb = getPocketBase();
  return withAuthRequestHeaders(pb, () => pb.send<AccountMailResponse>('/api/blog-auth/password-reset/request', {
    method: 'POST',
    body: { email: normalizeAuthEmail(email), altcha },
  }));
}

export async function requestEmailChange(newEmail: string): Promise<AccountMailResponse> {
  const pb = getPocketBase();
  return withAuthRequestHeaders(pb, () => pb.send<AccountMailResponse>('/api/blog-auth/email-change/request', {
    method: 'POST',
    body: { newEmail: normalizeAuthEmail(newEmail) },
  }));
}

export async function confirmPasswordResetToken(token: string, password: string, passwordConfirm: string): Promise<void> {
  const pb = getPocketBase();
  await withAuthRequestHeaders(pb, () => pb.collection('users').confirmPasswordReset(token, password, passwordConfirm));
}

export async function confirmEmailChangeToken(token: string, password: string): Promise<void> {
  const pb = getPocketBase();
  await withAuthRequestHeaders(pb, () => pb.collection('users').confirmEmailChange(token, password));
}
