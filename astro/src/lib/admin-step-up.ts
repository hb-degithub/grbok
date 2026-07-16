import type PocketBase from 'pocketbase';
import { getBrowserFingerprint } from './security';
import { isAdminRecoveryHeaderPath } from './admin-recovery-header';

const STEP_UP_KEY = 'blog.admin.step-up.v1';
const CLIENT_SESSION_KEY = 'blog.admin.client-session.v1';
const RECOVERY_CODE_KEY = 'blog.admin.recovery-code.v1';
const installedClients = new WeakSet<PocketBase>();

type StoredStepUp = { credential: string; expiresAt: string };

function hasSessionStorage(): boolean {
  try { return typeof window !== 'undefined' && !!window.sessionStorage; } catch { return false; }
}

function authRecordId(record: unknown): string {
  if (!record || typeof record !== 'object' || !('id' in record)) return '';
  const value = (record as { id?: unknown }).id;
  return typeof value === 'string' ? value : '';
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function getAdminClientSession(): string {
  if (!hasSessionStorage()) return '';
  let value = sessionStorage.getItem(CLIENT_SESSION_KEY);
  if (!value) {
    value = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    sessionStorage.setItem(CLIENT_SESSION_KEY, value);
  }
  return value;
}

export function saveAdminStepUp(credential: string, expiresAt: string): void {
  if (!hasSessionStorage()) return;
  sessionStorage.setItem(STEP_UP_KEY, JSON.stringify({ credential, expiresAt } satisfies StoredStepUp));
}

export function readAdminStepUp(): StoredStepUp | null {
  if (!hasSessionStorage()) return null;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STEP_UP_KEY) || '{}') as Partial<StoredStepUp>;
    if (!parsed.credential || !parsed.expiresAt || Date.parse(parsed.expiresAt) <= Date.now()) {
      sessionStorage.removeItem(STEP_UP_KEY);
      return null;
    }
    return { credential: parsed.credential, expiresAt: parsed.expiresAt };
  } catch {
    sessionStorage.removeItem(STEP_UP_KEY);
    return null;
  }
}

export function clearAdminStepUp(options: { includeClientSession?: boolean } = {}): void {
  if (!hasSessionStorage()) return;
  sessionStorage.removeItem(STEP_UP_KEY);
  if (options.includeClientSession) {
    sessionStorage.removeItem(CLIENT_SESSION_KEY);
    sessionStorage.removeItem(RECOVERY_CODE_KEY);
  }
}

export function saveAdminRecoveryCode(code: string): void {
  if (!hasSessionStorage()) return;
  const value = code.trim();
  if (value) sessionStorage.setItem(RECOVERY_CODE_KEY, value);
  else sessionStorage.removeItem(RECOVERY_CODE_KEY);
}

export function clearAdminRecoveryCode(): void {
  if (hasSessionStorage()) sessionStorage.removeItem(RECOVERY_CODE_KEY);
}

export function installAdminStepUpHeaders(pb: PocketBase): void {
  if (installedClients.has(pb)) return;
  installedClients.add(pb);
  const originalBeforeSend = pb.beforeSend;
  const apiOrigin = new URL(pb.baseUrl).origin;
  let activeUserId = authRecordId(pb.authStore.record);

  pb.authStore.onChange((token, record) => {
    const nextUserId = authRecordId(record);
    if (!token || !nextUserId || nextUserId !== activeUserId) clearAdminStepUp({ includeClientSession: true });
    activeUserId = nextUserId;
  }, false);

  pb.beforeSend = async (url, options) => {
    const prior = originalBeforeSend ? await originalBeforeSend(url, options) : options;
    const next = prior || options;
    let requestUrl: URL;
    try { requestUrl = new URL(url, pb.baseUrl); } catch { return next; }
    if (requestUrl.origin !== apiOrigin || typeof window === 'undefined') return next;

    const headers = new Headers(next.headers as HeadersInit | undefined);
    headers.set('X-Admin-Session', getAdminClientSession());
    headers.set('X-Browser-Fingerprint', await getBrowserFingerprint());
    headers.set('X-Auth-Client-Time', new Date().toISOString());
    headers.set('X-Requested-With', 'XMLHttpRequest');
    const stored = readAdminStepUp();
    if (stored) headers.set('X-Admin-Step-Up', stored.credential);
    const recoveryCode = sessionStorage.getItem(RECOVERY_CODE_KEY);
    if (recoveryCode && isAdminRecoveryHeaderPath(requestUrl.pathname)) {
      headers.set('X-Admin-Recovery-Code', recoveryCode);
    }
    next.headers = Object.fromEntries(headers.entries());
    return next;
  };
}
