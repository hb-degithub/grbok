// @vitest-environment node
// 纯源码静态契约断言，不需要 DOM；jsdom 环境会把 node:fs 外部化为浏览器模块。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 登录/后台外壳「科幻简约」最后一层视觉一致性静态断言（纯样式改动，无行为变更）。
 *
 * 依据 docs/superpowers/specs/2026-11-17-sci-fi-site-wide-design.md：
 *   - 外壳与控件统一走 global.css 的 `--sf-*` 令牌（浅色 #f1f3f5 / 石墨 #16191d /
 *     唯一强调 #0b6d76，暗色由 .dark 覆写整套令牌）；
 *   - 去掉玻璃拟态、重阴影、彩色渐变、canvas 像素层与 zinc/sky/indigo/teal 撞色；
 *   - 主按钮 = `--sf-accent` 背景 + `--sf-on-accent` 前景（深浅主题各自可读）；
 *   - 但业务契约必须原样保留：AdminGuard / 角色门禁 / 表单 prop 接口 /
 *     校验、限流、请求、TOTP 流程一行都不许动。
 */

const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relPath: string) => readFileSync(resolve(SRC_ROOT, relPath), 'utf8');

const adminLayout = read('layouts/AdminLayout.astro');

const ui = {
  'Input.tsx': read('components/ui/Input.tsx'),
  'PixelButton.tsx': read('components/ui/PixelButton.tsx'),
  'Button.tsx': read('components/ui/Button.tsx'),
} as const;

const pixelButtonCss = read('components/ui/PixelButton.css');

const authForms = {
  'PasswordLoginForm.tsx': read('components/auth/PasswordLoginForm.tsx'),
  'MagicLinkForm.tsx': read('components/auth/MagicLinkForm.tsx'),
  'RegisterForm.tsx': read('components/auth/RegisterForm.tsx'),
  'ForgotPasswordForm.tsx': read('components/auth/ForgotPasswordForm.tsx'),
  'ResetPasswordForm.tsx': read('components/auth/ResetPasswordForm.tsx'),
  'ConfirmEmailChangeForm.tsx': read('components/auth/ConfirmEmailChangeForm.tsx'),
  'EmailChangeForm.tsx': read('components/auth/EmailChangeForm.tsx'),
  'TotpStepGate.tsx': read('components/auth/TotpStepGate.tsx'),
  'TotpVerifyStep.tsx': read('components/auth/TotpVerifyStep.tsx'),
  'TotpSetupStep.tsx': read('components/auth/TotpSetupStep.tsx'),
} as const;

/** tsx / astro 源码文件：令牌值只允许出现在 global.css。 */
const sourceFiles: Record<string, string> = {
  'AdminLayout.astro': adminLayout,
  ...ui,
  ...authForms,
};

const SOURCE_ALL = Object.values(sourceFiles).join('\n');
const AUTH_ALL = Object.values(authForms).join('\n');

/** 改造前的装饰：玻璃、重阴影、渐变、撞色调色板、大圆角、写死浅色底。 */
const LEGACY_DECOR: Array<[string, RegExp]> = [
  ['玻璃拟态 backdrop-blur', /backdrop-blur/],
  ['阴影工具类 shadow-(xs|sm|md|lg|xl|2xl|inner)', /\bshadow-(?:xs|sm|md|lg|xl|2xl|inner)\b/],
  ['任意值阴影 shadow-[', /shadow-\[/],
  ['渐变背景 bg-gradient-to-', /bg-gradient-to-/],
  [
    'zinc/slate/gray/neutral/stone/sky/indigo/violet/purple/teal/cyan 撞色调色板',
    /\b(?:bg|text|border|from|to|via|ring|placeholder|divide|outline|fill|stroke)-(?:zinc|slate|gray|neutral|stone|sky|indigo|violet|purple|teal|cyan)-/,
  ],
  ['写死浅色底 bg-white', /\bbg-white\b/],
  ['写死白字 text-white', /\btext-white\b/],
  ['大圆角 rounded-(md|lg|xl|2xl|3xl)', /\brounded-(?:md|lg|xl|2xl|3xl)\b/],
];

const SF_TOKENS = [
  '--sf-canvas',
  '--sf-surface',
  '--sf-ink',
  '--sf-line',
  '--sf-line-control',
  '--sf-accent',
  '--sf-on-accent',
] as const;

describe('科幻简约 · 登录控件与后台外壳设计契约', () => {
  it('PixelButton 已移除 PixelCard canvas，且没有替代用的像素层样式', () => {
    const tsx = ui['PixelButton.tsx'];

    expect(tsx, 'PixelButton 仍 import PixelCard').not.toMatch(/from\s+'[^']*PixelCard'/);
    expect(tsx, 'PixelButton 仍在渲染 PixelCard 组件').not.toContain('<PixelCard');
    expect(tsx, 'PixelButton 仍在渲染 canvas').not.toMatch(/<canvas/i);
    expect(tsx, 'PixelButton 仍引用 pixel-canvas 类名').not.toContain('pixel-canvas');
    expect(tsx, 'PixelButton 仍持有 canvas 引用/像素色带 props').not.toMatch(/canvasRef|getContext\(|pixelCanvas/);

    expect(pixelButtonCss, 'PixelButton.css 仍存在 .pixel-canvas 定位层').not.toMatch(/\.pixel-canvas|pixel-canvas/);
    expect(pixelButtonCss, 'PixelButton.css 仍包含 canvas 像素层选择器').not.toMatch(/canvas\s*\{|canvas\s*,/);
    expect(pixelButtonCss, '像素层被替换成了径向渐变光晕').not.toContain('radial-gradient');
    expect(pixelButtonCss, '仍残留 rgba 光晕/阴影').not.toMatch(/rgba?\(/);
    expect(pixelButtonCss, '仍存在 hover 覆盖伪元素').not.toMatch(/::before/);

    for (const legacy of ['#0c4a6e', '#0f172a', '#e0f2fe', '#f1f5f9', '#ffffff', '#18181b']) {
      expect(pixelButtonCss, `仍残留旧像素按钮配色 ${legacy}`).not.toContain(legacy);
    }
  });

  it('PixelButton 保留原 props 接口与提交语义', () => {
    const src = ui['PixelButton.tsx'];
    for (const token of [
      'children: React.ReactNode;',
      'onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;',
      "type?: 'button' | 'submit';",
      'disabled?: boolean;',
      'loading?: boolean;',
      "variant?: 'primary' | 'secondary';",
      'className?: string;',
      'const isDisabled = disabled || loading;',
      'type={type}',
      'onClick={onClick}',
      'disabled={isDisabled}',
      'pixel-btn__inner',
      'pixel-btn__spinner',
      "variant === 'secondary' ? 'pixel-btn--secondary' : 'pixel-btn--primary'",
      'pixel-btn--disabled',
    ]) {
      expect(src, `PixelButton 接口/提交语义丢失：${token}`).toContain(token);
    }
    expect(src).toMatch(/export default function PixelButton/);
  });

  it('PixelButton.css 走 --sf-* 令牌，主按钮用 --sf-accent 背景 + --sf-on-accent 前景', () => {
    expect(pixelButtonCss).toContain('var(--sf-line-control)');
    expect(pixelButtonCss).toMatch(/var\(--sf-accent\)/);
    expect(pixelButtonCss, 'primary 前景必须使用 --sf-on-accent（浅色 #fff / 暗色 #16191d）').toContain(
      'var(--sf-on-accent'
    );
    expect(pixelButtonCss, '保留 spinner 动画').toContain('pixel-btn-spin');
    expect(pixelButtonCss, '保留 disabled 视觉').toContain('.pixel-btn--disabled');
  });

  it('Input 保留 label/htmlFor/错误 aria/helper/id 逻辑，边框控制用 --sf-line-control', () => {
    const src = ui['Input.tsx'];
    for (const token of [
      'label?: string;',
      'error?: string;',
      'helperText?: string;',
      "Omit<React.InputHTMLAttributes<HTMLInputElement>, 'ref'>",
      'const inputId = id || label?.toLowerCase().replace(/\\s+/g, \'-\');',
      'htmlFor={inputId}',
      'id={inputId}',
      'aria-invalid={!!error}',
      'aria-describedby={error ? errorId : helperText ? helperId : undefined}',
      'role="alert"',
      '{helperText && !error &&',
      'id={errorId}',
      'id={helperId}',
    ]) {
      expect(src, `Input 无障碍/传入逻辑丢失：${token}`).toContain(token);
    }
    expect(src).toContain('var(--sf-line-control)');
    expect(src).toContain('var(--sf-surface)');
    expect(src, '错误红作为语义色保留').toMatch(/text-red-\d{3}/);
    expect(src).toMatch(/export default function Input/);
  });

  it('Button 保留 variant/size/loading 接口，变体落 --sf-* 令牌并克制缩放', () => {
    const src = ui['Button.tsx'];
    for (const token of [
      "type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline';",
      "type ButtonSize = 'sm' | 'md' | 'lg';",
      "Omit<HTMLMotionProps<'button'>, 'children'>",
      'variant?: ButtonVariant;',
      'size?: ButtonSize;',
      'loading?: boolean;',
      'children: React.ReactNode;',
      'disabled={disabled || loading}',
      '{loading && (',
      'whileHover={{ scale: 1.01 }}',
      'whileTap={{ scale: 0.99 }}',
    ]) {
      expect(src, `Button 接口/动效契约丢失：${token}`).toContain(token);
    }
    expect(src, '主按钮必须用 --sf-accent 背景').toContain('bg-[var(--sf-accent)]');
    expect(src, '主按钮前景必须用 --sf-on-accent').toContain('var(--sf-on-accent');
    expect(src).toContain('var(--sf-line-control)');
    expect(src).toMatch(/export default function Button/);
  });

  it('AdminLayout 外壳与 topbar 改用 --sf-canvas/surface/ink/line/line-control，去浅色写死与玻璃重阴影', () => {
    for (const token of [
      'var(--sf-canvas)',
      'var(--sf-surface)',
      'var(--sf-ink)',
      'var(--sf-line)',
      'var(--sf-line-control)',
    ]) {
      expect(adminLayout, `AdminLayout 缺少令牌 ${token}`).toContain(token);
    }

    expect(adminLayout, '仍写死浅色画布 #f6f6f3').not.toContain('#f6f6f3');
    expect(adminLayout, 'topbar 仍有玻璃拟态').not.toContain('backdrop-blur');
    expect(adminLayout, '仍存在阴影工具类').not.toMatch(/shadow-/);
    expect(adminLayout, '仍使用旧主题色类').not.toMatch(/\b(?:text-text|border-border|bg-success|text-muted)/);
    expect(adminLayout).toContain('admin-shell');
    expect(adminLayout).toContain('admin-topbar');
  });

  it('AdminLayout 保留 AdminGuard、角色门禁、布局宽度与入场动画', () => {
    for (const token of [
      "import AdminSidebar from '../components/admin/AdminSidebar';",
      "import AdminGuard from '../components/admin/AdminGuard';",
      "import type { AdminRole } from '../hooks/useAdminAuth';",
      'requiredRole?: AdminRole;',
      "const { title, description = '博客后台管理面板', requiredRole = 'author' } = Astro.props;",
      'const requiredRoleLabel: Record<AdminRole, string> = {',
      'requiredRoleLabel[requiredRole]',
      '<AdminGuard client:only="react" requiredRole={requiredRole}>',
      '<AdminSidebar client:only="react" />',
      'min-h-[100svh]',
      'max-w-[1440px]',
      'lg:ml-[var(--admin-sidebar-width,15.5rem)]',
      'transition-[margin] duration-300 ease-out',
      'pb-[calc(2rem+env(safe-area-inset-bottom))]',
      'sticky top-0 z-30',
      'admin-rise',
      '@media (prefers-reduced-motion: reduce)',
      '<slot />',
    ]) {
      expect(adminLayout, `AdminLayout 结构/门禁契约丢失：${token}`).toContain(token);
    }

    for (const roleLabel of ['普通用户', '作者', '管理员', '超级管理员']) {
      expect(adminLayout).toContain(roleLabel);
    }
  });

  it('全部目标源码文件不使用旧装饰调色板/玻璃/重阴影/大圆角', () => {
    for (const [name, src] of Object.entries(sourceFiles)) {
      for (const [label, pattern] of LEGACY_DECOR) {
        expect(src, `${name} 仍包含${label}`).not.toMatch(pattern);
      }
      expect(src, `${name} 写死了十六进制色值，应改用 --sf-* 令牌`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });

  it('登录表单改用 --sf-* 令牌并保留默认导出', () => {
    const formsNeedingTokens = [
      'PasswordLoginForm.tsx',
      'MagicLinkForm.tsx',
      'RegisterForm.tsx',
      'ForgotPasswordForm.tsx',
      'ResetPasswordForm.tsx',
      'ConfirmEmailChangeForm.tsx',
      'EmailChangeForm.tsx',
      'TotpVerifyStep.tsx',
      'TotpSetupStep.tsx',
    ] as const;

    for (const name of formsNeedingTokens) {
      expect(authForms[name], `${name} 未使用科幻设计令牌`).toContain('var(--sf-');
    }

    for (const [name, src] of Object.entries(authForms)) {
      expect(src, `${name} 必须默认导出`).toMatch(/export default function \w+/);
    }
  });

  it('表单语义色未被消色：成功/警告/错误仍可辨识', () => {
    expect(authForms['TotpStepGate.tsx'], '状态未知警告不应被消色').toContain('amber');
    expect(authForms['TotpVerifyStep.tsx'], '恢复码警告不应被消色').toContain('amber');
    expect(authForms['TotpVerifyStep.tsx'], '绑定提示仍应可辨识').toContain('emerald');
    expect(authForms['MagicLinkForm.tsx'], '验证码已发送提示仍应可辨识').toContain('emerald');
    expect(ui['Input.tsx'], '错误红保留为语义色').toMatch(/red-\d{3}/);
    expect(authForms['ResetPasswordForm.tsx'], '令牌失效错误仍为红色语义').toContain('red');
  });

  it('密码登录保留鉴权请求、限流、锁定与 TOTP 分支（未改提交逻辑）', () => {
    const src = authForms['PasswordLoginForm.tsx'];
    for (const token of [
      'runAfterAdminCredentialRevoked(',
      'authService.getPocketBase().collection(\'users\').authWithPassword(normalizedEmail, ',
      'MFA_UNSUPPORTED',
      'loginLimiter.tryConsume()',
      'getAuthLockRemainingSeconds(attemptKey)',
      'recordAuthFailure(attemptKey)',
      'setAuthLock(key, fallbackSeconds)',
      'formatAuthLock(seconds)',
      'totpEnforcedRoles.has(String(role))',
      'setTotpStep(true)',
      'normalizeAuthEmail(email)',
      'withAuthRequestHeaders(',
      'TotpStepGate',
      'useAuth',
      'noValidate',
      "'请填写邮箱和密码'",
      "'邮箱或密码错误'",
      '登录尝试过多，请 ',
      "'操作太频繁，请稍后再试'",
      'autoComplete="current-password"',
      'type="submit"',
      'variant="primary"',
      '忘记密码？',
    ]) {
      expect(src, `PasswordLoginForm 业务契约丢失：${token}`).toContain(token);
    }
  });

  it('验证码登录保留 OTP 请求/校验与重发、换邮箱交互', () => {
    const src = authForms['MagicLinkForm.tsx'];
    for (const token of [
      // 人机验证改造后，发送验证码的请求带上 ALTCHA payload（可选第二参数）。
      // 断言同步收紧到新的完整调用形态，调用被删仍然会红。
      'requestOTP(email, captcha.payload ?? undefined)',
      'authWithOTP(otpId, normalizedCode)',
      'const isValidEmail = (value: string)',
      'getPostLoginRedirect(data?.record?.role)',
      "step === 'email'",
      "'请输入验证码'",
      "'验证码无效或已过期'",
      "'请先获取验证码'",
      "'请输入邮箱地址'",
      "'邮箱格式不正确'",
      '验证码已发送，请查看邮箱并输入收到的验证码。',
      '<PixelButton type="button" onClick={requestCode} disabled={isBusy} variant="secondary">重新发送</PixelButton>',
      '<PixelButton type="button" onClick={goBackToEmail} disabled={isBusy} variant="secondary">更换邮箱</PixelButton>',
      'loading={isBusy}',
    ]) {
      expect(src, `MagicLinkForm 业务契约丢失：${token}`).toContain(token);
    }
  });

  it('注册表单保留校验顺序、限流与注册请求', () => {
    const src = authForms['RegisterForm.tsx'];
    for (const token of [
      'registerReader({',
      'registerLimiter.tryConsume()',
      "'请填写昵称、邮箱、密码和确认密码'",
      "'邮箱格式不正确'",
      "'密码至少需要 8 个字符'",
      "'两次输入的密码不一致'",
      "'/?verify_email_sent=1'",
      'autoComplete="new-password"',
      'autoComplete="email"',
      'autoComplete="name"',
    ]) {
      expect(src, `RegisterForm 业务契约丢失：${token}`).toContain(token);
    }
  });

  it('找回/重置密码表单保留请求、限流与令牌错误分支', () => {
    const forgot = authForms['ForgotPasswordForm.tsx'];
    for (const token of [
      // 人机验证改造后，重置邮件请求带上 ALTCHA payload（可选第二参数）。
      'requestPasswordReset(trimmedEmail, captcha.payload ?? undefined)',
      'isAccountMailRateLimited(response)',
      'forgotLimiter.tryConsume()',
      "'请输入邮箱地址'",
      "'邮箱格式不正确'",
      "'操作太频繁，请稍后再试'",
      'retryAfterSeconds',
      '重置邮件已发送',
      '参考号：',
      'autoComplete="email"',
    ]) {
      expect(forgot, `ForgotPasswordForm 业务契约丢失：${token}`).toContain(token);
    }

    const reset = authForms['ResetPasswordForm.tsx'];
    for (const token of [
      'confirmPasswordResetToken(token, password, passwordConfirm)',
      "'缺少重置令牌，请通过邮件中的链接访问此页面'",
      "'两次输入的密码不一致'",
      "'密码至少需要 8 个字符'",
      'setTokenError(',
      'tokenError',
      '链接无效',
      '密码已重置',
      'autoComplete="new-password"',
    ]) {
      expect(reset, `ResetPasswordForm 业务契约丢失：${token}`).toContain(token);
    }
  });

  it('邮箱变更表单保留确认令牌、当前密码与脱敏展示逻辑', () => {
    const confirm = authForms['ConfirmEmailChangeForm.tsx'];
    for (const token of [
      'confirmEmailChangeToken(token, password)',
      "'请输入当前密码以确认变更'",
      'autoComplete="current-password"',
      'setTokenError(',
      '链接无效',
      '邮箱已变更',
      '重新登录',
    ]) {
      expect(confirm, `ConfirmEmailChangeForm 业务契约丢失：${token}`).toContain(token);
    }

    const change = authForms['EmailChangeForm.tsx'];
    for (const token of [
      'requestEmailChange(trimmedEmail)',
      'isAccountMailRateLimited(response)',
      'maskEmailLocal',
      'getUserDisplayName(user)',
      "'新邮箱不能与当前邮箱相同'",
      "'邮箱格式不正确'",
      '确认邮件已发送',
      'autoComplete="email"',
    ]) {
      expect(change, `EmailChangeForm 业务契约丢失：${token}`).toContain(token);
    }
  });

  it('TOTP 三步流程（gate/verify/setup）原样保留', () => {
    const gate = authForms['TotpStepGate.tsx'];
    for (const token of [
      'fetchAdminVerificationStatus()',
      'setFailed(true)',
      "status === 'totp_setup_required'",
      "'recovery_reenroll'",
      'setAttempt((n) => n + 1)',
      'onReturnToLogin',
      'if (status === null) return null;',
      '无法获取二次验证状态（网络或边缘节点异常），请重试。',
      '重试',
      '返回登录',
    ]) {
      expect(gate, `TotpStepGate 流程契约丢失：${token}`).toContain(token);
    }

    const verify = authForms['TotpVerifyStep.tsx'];
    for (const token of [
      'verifyAdminTotp(code.trim())',
      'saveAdminRecoveryCode(recoveryCode.trim())',
      '/^\\d{6}$/.test(code.trim())',
      "'请输入 6 位动态码'",
      "'请输入恢复码'",
      'window.location.reload()',
      'showRecovery',
      '身份验证器不可用？使用恢复码',
      'describeTotpError(err, \'动态码校验失败\')',
      'autoComplete="one-time-code"',
    ]) {
      expect(verify, `TotpVerifyStep 流程契约丢失：${token}`).toContain(token);
    }

    const setup = authForms['TotpSetupStep.tsx'];
    for (const token of [
      'startAdminTotpSetup()',
      'confirmAdminTotpSetup(code.trim())',
      'drawQrToCanvas(canvasRef.current, result.uri, 200)',
      'navigator.clipboard.writeText(base32)',
      "'已复制'",
      'saveRecoveryAndReload',
      '首次进入需绑定身份验证器（TOTP）',
      'aria-label="TOTP 绑定二维码"',
      'autoComplete="one-time-code"',
    ]) {
      expect(setup, `TotpSetupStep 流程契约丢失：${token}`).toContain(token);
    }
  });

  it('表单提交按钮仍走 PixelButton/Button 共享控件（不复制提交逻辑）', () => {
    const submitters = [
      'PasswordLoginForm.tsx',
      'MagicLinkForm.tsx',
      'RegisterForm.tsx',
      'ForgotPasswordForm.tsx',
      'ResetPasswordForm.tsx',
      'ConfirmEmailChangeForm.tsx',
      'EmailChangeForm.tsx',
    ] as const;

    for (const name of submitters) {
      const src = authForms[name];
      expect(src, `${name} 未使用 PixelButton`).toContain('<PixelButton');
      expect(src, `${name} 提交按钮缺少 loading 绑定`).toMatch(/loading=\{(?:status === 'loading'|isBusy)\}/);
      expect(src, `${name} 不应内联复刻提交按钮样式`).not.toContain('pixel-btn');
    }

    expect(adminLayout).not.toMatch(/<PixelButton|<Button/);
  });

  it('SF 令牌层覆盖 canvas/surface/ink/line/line-control/accent/on-accent', () => {
    const covered = [pixelButtonCss, ui['Button.tsx'], ui['Input.tsx'], adminLayout].join('\n');

    for (const token of SF_TOKENS) {
      const used = covered.includes(`var(${token})`) || covered.includes(`var(${token},`);
      expect(used, `缺少令牌 var(${token})`).toBe(true);
    }

    expect(SOURCE_ALL, '源码中出现 dark: 装饰调色板应由 .dark 令牌接管').not.toMatch(
      /dark:(?:bg|text|border)-(?:zinc|slate|gray|neutral|stone|sky|indigo|violet|purple|teal|cyan)-/
    );
    expect(AUTH_ALL, '源码中出现十六进制色值').not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
