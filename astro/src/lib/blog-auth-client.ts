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

export async function requestPasswordMfaOtp(email: string, mfaId: string): Promise<{ otpId: string }> {
  const pb = getPocketBase();
  return withAuthRequestHeaders(pb, () => pb.send<{ otpId: string }>('/api/blog-auth/mfa/otp/request', { method: 'POST', body: { email: normalizeAuthEmail(email), mfaId } }));
}

export async function verifyPasswordMfaOtp(otpId: string, code: string, mfaId: string): Promise<AuthResponse> {
  const pb = getPocketBase();
  const result = await withAuthRequestHeaders(pb, () => pb.send<AuthResponse>('/api/blog-auth/mfa/otp/verify', { method: 'POST', body: { otpId, code, mfaId } }));
  pb.authStore.save(result.token, result.record);
  return result;
}
