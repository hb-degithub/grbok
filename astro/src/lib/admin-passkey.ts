import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { getPocketBase } from './pocketbase';
import { clearAdminStepUp, saveAdminStepUp } from './admin-step-up';

const ADMIN_CAPABLE_ROLES = ['author', 'admin', 'super_admin'];

export function isAdminCapableRole(role: unknown): boolean {
  return typeof role === 'string' && ADMIN_CAPABLE_ROLES.includes(role);
}

export type AdminStepUpStatus = 'bootstrap_required' | 'verified' | 'expired' | 'binding_changed';
export type AdminVerificationStatus = { status: AdminStepUpStatus; verified: boolean; expiresAt?: string };

export async function fetchAdminVerificationStatus(): Promise<AdminVerificationStatus> {
  const pb = getPocketBase();
  const result = await pb.send('/api/blog-admin/step-up/status', { method: 'GET' }) as AdminVerificationStatus;
  if (result.status === 'binding_changed' || result.status === 'expired') clearAdminStepUp();
  return result;
}

export async function requestAdminPasskeyVerification(): Promise<AdminVerificationStatus> {
  const pb = getPocketBase();

  const options = await pb.send('/api/blog-admin/step-up/options', { method: 'POST' });

  const assertion = await startAuthentication({ optionsJSON: options });

  const result = await pb.send('/api/blog-admin/step-up/verify', {
    method: 'POST',
    body: { response: assertion },
  }) as { verified: boolean; credential: string; expiresAt: string };
  if (result.verified && result.credential && result.expiresAt) {
    saveAdminStepUp(result.credential, result.expiresAt);
    return { status: 'verified', verified: true, expiresAt: result.expiresAt };
  }
  return { status: 'expired', verified: false };
}

export async function registerAdminPasskey(label: string): Promise<{ verified: boolean; credentialId?: string }> {
  const pb = getPocketBase();

  const options = await pb.send('/api/blog-admin/passkeys/registration/options', { method: 'POST' });

  const attestation = await startRegistration({ optionsJSON: options });

  const result = await pb.send('/api/blog-admin/passkeys/registration/verify', {
    method: 'POST',
    body: { response: attestation, label },
  }) as { verified: boolean; item?: { id: string } };
  return { verified: result.verified, credentialId: result.item?.id };
}
