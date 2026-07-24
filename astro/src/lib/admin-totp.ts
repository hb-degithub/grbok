import { getPocketBase } from './pocketbase';
import { clearAdminRecoveryCode, clearAdminStepUp, saveAdminStepUp } from './admin-step-up';
import { shouldClearRecoveryCodeAfterStatus } from './admin-recovery-header';

const ADMIN_CAPABLE_ROLES = ['author', 'admin', 'super_admin'];

export function isAdminCapableRole(role: unknown): boolean {
  return typeof role === 'string' && ADMIN_CAPABLE_ROLES.includes(role);
}

export type AdminStepUpStatus = 'totp_setup_required' | 'recovery_reenroll' | 'verified' | 'expired' | 'binding_changed';
export type AdminVerificationStatus = { status: AdminStepUpStatus; verified: boolean; expiresAt?: string };
export type TotpSetupResult = { uri: string; base32: string; mode: 'setup' | 'recovery' | 'rebind' };

export async function fetchAdminVerificationStatus(): Promise<AdminVerificationStatus> {
  const pb = getPocketBase();
  const result = await pb.send('/api/blog-admin/step-up/status', { method: 'GET' }) as AdminVerificationStatus;
  if (result.status === 'binding_changed' || result.status === 'expired') clearAdminStepUp();
  if (shouldClearRecoveryCodeAfterStatus(result.status)) clearAdminRecoveryCode();
  return result;
}

/** 生成 TOTP 密钥，返回 otpauth URI（二维码内容）与 base32 密钥（手动录入） */
export async function startAdminTotpSetup(): Promise<TotpSetupResult> {
  const pb = getPocketBase();
  return pb.send('/api/blog-admin/totp/setup', { method: 'POST' }) as Promise<TotpSetupResult>;
}

/** 用首枚 6 位码确认绑定；成功后服务端直接签发 step-up 会话 */
export async function confirmAdminTotpSetup(code: string): Promise<AdminVerificationStatus> {
  const pb = getPocketBase();
  const result = await pb.send('/api/blog-admin/totp/confirm', {
    method: 'POST',
    body: { code },
  }) as { verified: boolean; credential: string; expiresAt: string };
  if (result.verified && result.credential && result.expiresAt) {
    saveAdminStepUp(result.credential, result.expiresAt);
    clearAdminRecoveryCode();
    return { status: 'verified', verified: true, expiresAt: result.expiresAt };
  }
  return { status: 'expired', verified: false };
}

/** 6 位码完成 step-up 验证 */
export async function verifyAdminTotp(code: string): Promise<AdminVerificationStatus> {
  const pb = getPocketBase();
  const result = await pb.send('/api/blog-admin/totp/verify', {
    method: 'POST',
    body: { code },
  }) as { verified: boolean; credential: string; expiresAt: string };
  if (result.verified && result.credential && result.expiresAt) {
    saveAdminStepUp(result.credential, result.expiresAt);
    return { status: 'verified', verified: true, expiresAt: result.expiresAt };
  }
  return { status: 'expired', verified: false };
}

/** 吊销当前绑定（需有效 step-up） */
export async function revokeAdminTotp(): Promise<{ revoked: boolean }> {
  const pb = getPocketBase();
  const result = await pb.send('/api/blog-admin/totp/revoke', { method: 'POST' }) as { revoked: boolean };
  if (result.revoked) clearAdminStepUp();
  return result;
}
