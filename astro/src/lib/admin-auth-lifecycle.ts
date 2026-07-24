export const ADMIN_CREDENTIAL_REVOKE_FAILED = 'ADMIN_CREDENTIAL_REVOKE_FAILED';

type AuthStoreLike = {
  token?: string;
  record?: unknown;
  clear: () => void;
};

type PocketBaseLike = {
  authStore: AuthStoreLike;
  send: (path: string, options: { method: string }) => Promise<unknown>;
};

type StatusBearingError = {
  status?: unknown;
  response?: { status?: unknown };
};

export class AdminCredentialRevokeError extends Error {
  readonly code = ADMIN_CREDENTIAL_REVOKE_FAILED;

  constructor(cause: unknown) {
    super(ADMIN_CREDENTIAL_REVOKE_FAILED, { cause });
    this.name = 'AdminCredentialRevokeError';
  }
}

function responseStatus(error: unknown): number {
  if (!error || typeof error !== 'object') return 0;
  const candidate = error as StatusBearingError;
  const value = candidate.status ?? candidate.response?.status;
  return typeof value === 'number' ? value : 0;
}

export function isServerConfirmedCredentialInvalid(error: unknown): boolean {
  const status = responseStatus(error);
  return status === 401 || status === 403;
}

export async function revokeCurrentAdminCredential(
  pb: PocketBaseLike,
  clearLocalCredential: () => void,
): Promise<{ revoked: boolean; alreadyInvalid: boolean }> {
  if (!pb.authStore.token && !pb.authStore.record) {
    clearLocalCredential();
    pb.authStore.clear();
    return { revoked: false, alreadyInvalid: false };
  }

  let alreadyInvalid = false;
  try {
    const response = await pb.send('/api/blog-admin/step-up/revoke', { method: 'POST' });
    if (!response || typeof response !== 'object' || (response as { revoked?: unknown }).revoked !== true) {
      throw new Error('invalid revoke response');
    }
  } catch (error) {
    if (!isServerConfirmedCredentialInvalid(error)) {
      throw new AdminCredentialRevokeError(error);
    }
    alreadyInvalid = true;
  }

  clearLocalCredential();
  pb.authStore.clear();
  return { revoked: !alreadyInvalid, alreadyInvalid };
}

export async function runAfterAdminCredentialRevoked<T>(
  pb: PocketBaseLike,
  clearLocalCredential: () => void,
  operation: () => Promise<T>,
): Promise<T> {
  await revokeCurrentAdminCredential(pb, clearLocalCredential);
  return operation();
}
