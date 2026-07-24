const RECOVERY_HEADER_PATHS = new Set([
  '/api/blog-admin/step-up/status',
  '/api/blog-admin/passkeys/registration/options',
  '/api/blog-admin/passkeys/registration/verify',
]);

type StatusBearingError = {
  status?: unknown;
  response?: { status?: unknown };
};

export function isAdminRecoveryHeaderPath(pathname: string): boolean {
  return RECOVERY_HEADER_PATHS.has(pathname);
}

export function shouldClearRecoveryCodeAfterStatus(status: string): boolean {
  return status !== 'recovery_reenroll';
}

export function shouldClearRecoveryCodeAfterRequestError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as StatusBearingError;
  const status = candidate.status ?? candidate.response?.status;
  return status === 401 || status === 403;
}
