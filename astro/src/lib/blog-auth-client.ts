import { getPocketBase } from './pocketbase';
import { normalizeAuthEmail, withAuthRequestHeaders } from './security';
import type { ReaderRegisterData } from '../types/pocketbase';
import type { User } from '../types/pocketbase';

export interface AcceptedResponse {
  accepted: true;
  code: 'REGISTRATION_SUBMITTED' | 'MAIL_REQUEST_ACCEPTED';
  referenceId: string;
  message?: string;
}

export type RegisterInput = Omit<ReaderRegisterData, 'role'> & { inviteCode?: string };

export async function registerReader(input: RegisterInput): Promise<AcceptedResponse> {
  const pb = getPocketBase();
  return withAuthRequestHeaders(pb, () => pb.send<AcceptedResponse>('/api/blog-auth/register', {
    method: 'POST',
    body: { ...input, email: normalizeAuthEmail(input.email) },
  }));
}

export async function requestVerification(email: string): Promise<AcceptedResponse> {
  const pb = getPocketBase();
  return withAuthRequestHeaders(pb, () => pb.send<AcceptedResponse>('/api/blog-auth/verification/request', {
    method: 'POST',
    body: { email: normalizeAuthEmail(email) },
  }));
}

export interface ReaderOtpResponse extends AcceptedResponse { challengeId: string; expiresIn: number }
export interface AuthResponse { token: string; record: User }

export async function requestReaderOtp(email: string): Promise<ReaderOtpResponse> {
  const pb = getPocketBase();
  return withAuthRequestHeaders(pb, () => pb.send<ReaderOtpResponse>('/api/blog-auth/otp/request', { method: 'POST', body: { email: normalizeAuthEmail(email) } }));
}

export async function verifyReaderOtp(challengeId: string, code: string): Promise<AuthResponse> {
  const pb = getPocketBase();
  const result = await withAuthRequestHeaders(pb, () => pb.send<AuthResponse>('/api/blog-auth/otp/verify', { method: 'POST', body: { challengeId, code } }));
  pb.authStore.save(result.token, result.record);
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

export async function requestPasswordReset(email: string): Promise<AccountMailResponse> {
  const pb = getPocketBase();
  return withAuthRequestHeaders(pb, () => pb.send<AccountMailResponse>('/api/blog-auth/password-reset/request', {
    method: 'POST',
    body: { email: normalizeAuthEmail(email) },
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
