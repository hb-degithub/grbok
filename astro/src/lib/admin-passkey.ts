import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { getPocketBase } from './pocketbase';
import { withAuthRequestHeaders } from './security';

const ADMIN_CAPABLE_ROLES = ['author', 'admin', 'super_admin'];

export function isAdminCapableRole(role: unknown): boolean {
  return typeof role === 'string' && ADMIN_CAPABLE_ROLES.includes(role);
}

export async function fetchAdminVerificationStatus(): Promise<{ verified: boolean; expires_at?: string }> {
  const pb = getPocketBase();
  return withAuthRequestHeaders(pb, () =>
    pb.send('/api/blog-admin/webauthn/session', { method: 'GET' })
  );
}

export async function requestAdminPasskeyVerification(): Promise<{ verified: boolean; expires_at?: string }> {
  const pb = getPocketBase();

  const options = await withAuthRequestHeaders(pb, () =>
    pb.send('/api/blog-admin/webauthn/authenticate/options', { method: 'POST' })
  );

  const assertion = await startAuthentication({ optionsJSON: options });

  return withAuthRequestHeaders(pb, () =>
    pb.send('/api/blog-admin/webauthn/authenticate/verify', {
      method: 'POST',
      body: { response: assertion },
    })
  );
}

export async function registerAdminPasskey(label: string): Promise<{ verified: boolean; credentialId?: string }> {
  const pb = getPocketBase();

  const options = await withAuthRequestHeaders(pb, () =>
    pb.send('/api/blog-admin/webauthn/register/options', { method: 'POST' })
  );

  const attestation = await startRegistration({ optionsJSON: options });

  return withAuthRequestHeaders(pb, () =>
    pb.send('/api/blog-admin/webauthn/register/verify', {
      method: 'POST',
      body: { response: attestation, label },
    })
  );
}
