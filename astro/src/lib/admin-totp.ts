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
  // 边缘/CDN 偶发返回陈旧的 4xx（曾命中 ESA 缓存的旧 403），
  // 短暂重试两次再放弃，避免一次抖动就把界面带向错误分支。
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await pb.send('/api/blog-admin/step-up/status', { method: 'GET' }) as AdminVerificationStatus;
      if (result.status === 'binding_changed' || result.status === 'expired') clearAdminStepUp();
      if (shouldClearRecoveryCodeAfterStatus(result.status)) clearAdminRecoveryCode();
      return result;
    } catch (err) {
      lastError = err;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 700));
    }
  }
  throw lastError;
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

/** 把后端 TOTP 错误码翻译成用户可读文案 */
export function describeTotpError(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : '';
  if (message.includes('TOTP_CODE_REPLAYED')) return '该动态码已使用，请等 App 刷新出下一个码再试';
  if (message.includes('TOTP_CODE_INVALID')) return '动态码不正确，请核对后重试';
  if (message.includes('TOTP_NOT_BOUND')) return '尚未绑定身份验证器';
  return message || fallback;
}

/** 吊销当前绑定（需有效 step-up） */
export async function revokeAdminTotp(): Promise<{ revoked: boolean }> {
  const pb = getPocketBase();
  const result = await pb.send('/api/blog-admin/totp/revoke', { method: 'POST' }) as { revoked: boolean };
  if (result.revoked) clearAdminStepUp();
  return result;
}
