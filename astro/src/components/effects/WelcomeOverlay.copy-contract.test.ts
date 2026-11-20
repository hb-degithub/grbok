// @vitest-environment node
// 静态契约只读源码文本，用 node 环境以便直接使用 node:fs（jsdom 下会被 externalize）。
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

/**
 * 与 scripts/check-auth-facade-cutover.ps1 逐条对齐的静态断言。
 *
 * Ops config gate 在 windows-latest 上用 Windows PowerShell 5.1 执行该脚本；
 * 这里复刻其中与 WelcomeOverlay / RegisterForm 相关的 Require（L34 / L43 / L45 /
 * L47 / L48 / L49），让「安全文案被改回不安全形态」在 vitest 阶段先失败，而不是
 * 等到 CI 的 Ops config gate 才红。
 *
 * 关键约束（不要放宽）：
 * - 肯定成功文案（注册成功 + 全角感叹号）只能出现在无邮箱分支，且必须与中性提示
 *   「提交后请验证邮箱」写在同一行，证明它仍是无邮箱分支的三元表达式；
 * - 根因：pb_hooks/lib/registration_facade.js:97 对重复邮箱同样返回
 *   202 REGISTRATION_SUBMITTED 且不发送邮件，有邮箱时任何「已发送」断言都会泄露
 *   邮箱是否已注册，所以有邮箱只能给中性的「提交后请验证邮箱，验证完成后可评论」；
 * - RegisterForm 不能宣称注册成功，但必须保留「提交注册」「请验证邮箱」。
 */
function readSource(relativePath: string): string {
  return readFileSync(new URL(`./${relativePath}`, import.meta.url), 'utf8');
}

const welcomeSource = readSource('WelcomeOverlay.tsx');
const registerSource = readFileSync(new URL('../auth/RegisterForm.tsx', import.meta.url), 'utf8');

describe('注册安全文案静态契约（check-auth-facade-cutover.ps1）', () => {
  it('L34 不出现「注册并登录」或「邮箱可能已被注册」', () => {
    expect(`${welcomeSource}${registerSource}`).not.toMatch(/注册并登录|邮箱可能已被注册/);
  });

  it('L43/L45 肯定成功文案只出现在与中性提示同一行的无邮箱分支', () => {
    const successLines = welcomeSource.match(/^.*注册成功！.*$/gm) ?? [];
    expect(successLines.length).toBeGreaterThanOrEqual(1);
    for (const line of successLines) {
      expect(line).toMatch(/提交后请验证邮箱/);
    }
  });

  it('L47 RegisterForm 不宣称注册成功', () => {
    expect(registerSource).not.toMatch(/注册成功/);
  });

  it('L48 RegisterForm 保留提交注册与请验证邮箱文案', () => {
    expect(registerSource).toMatch(/提交注册/);
    expect(registerSource).toMatch(/请验证邮箱/);
  });

  it('L49 WelcomeOverlay 保留「提交后请验证邮箱，验证完成后可评论」', () => {
    expect(welcomeSource).toMatch(/提交后请验证邮箱，验证完成后可评论/);
  });
});
