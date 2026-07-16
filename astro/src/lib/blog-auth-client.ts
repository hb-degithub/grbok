import { getPocketBase } from './pocketbase';
import { normalizeAuthEmail, withAuthRequestHeaders } from './security';
import type { ReaderRegisterData } from '../types/pocketbase';

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
