import React from 'react';
import { motion } from 'framer-motion';
import TotpManager from './TotpManager';
import SecurityRatePolicyForm from './SecurityRatePolicyForm';
import SecurityStatus from './SecurityStatus';

interface AuditItem { name: string; status: 'pass' | 'warn' | 'fail'; description: string; recommendation: string; }

const auditItems: AuditItem[] = [
  { name: 'HTTPS 与 HSTS', status: 'pass', description: '公网入口由 1Panel OpenResty 提供 HTTPS，站点配置包含 HSTS。', recommendation: '' },
  { name: '登录接口限流', status: 'pass', description: 'OpenResty 对密码登录、管理员登录、OTP 请求和 OTP 校验接口启用按 IP 限流，超限返回 429。', recommendation: '' },
  { name: 'PocketBase 登录 Hook', status: 'pass', description: 'login_security.pb.js 保持禁用，避免破坏正确登录；登录防爆破前移到 OpenResty 层。', recommendation: '' },
  { name: 'PocketBase 管理端访问', status: 'pass', description: '/_/admin 由 Caddy 按 ADMIN_IP 白名单限制访问。', recommendation: '' },
  { name: '角色权限保护', status: 'pass', description: '后台菜单、页面守卫和 PocketBase 规则按作者、管理员、超级管理员分层控制。', recommendation: '' },
  { name: '用户角色写入保护', status: 'pass', description: 'guard_user_role.pb.js 强制普通注册只能成为普通用户，只有超级管理员可以提升角色。', recommendation: '' },
  { name: '管理员 TOTP', status: 'pass', description: '管理后台访问已启用 TOTP 动态码二次验证，管理员与超级管理员强制验证并可绑定或吊销，作者等其他角色免验证。', recommendation: '' },
  { name: '评论审核', status: 'pass', description: '新评论默认进入待审核状态，前台仅读取已通过评论。', recommendation: '' },
  { name: '评论 XSS 防护', status: 'pass', description: '评论 hook 会去除 HTML 标签，前端展示评论时不使用 HTML 注入。', recommendation: '' },
  { name: '扫描路径拦截', status: 'pass', description: 'Caddy 拦截 .env、.git、wp-*、phpmyadmin、shell、config 等常见扫描路径。', recommendation: '' },
  { name: '安全响应头', status: 'pass', description: 'Caddy 设置 X-Frame-Options、X-Content-Type-Options、Referrer-Policy、Permissions-Policy 和 CSP。', recommendation: '' },
  { name: '认证 Token 存储', status: 'warn', description: 'PocketBase 默认把认证 token 放在浏览器 localStorage。当前后台每次加载会 authRefresh 校验并清理失效 token，但 XSS 场景下仍有被读取风险。', recommendation: '长期加固可考虑通过 Astro API 层代理认证，并改为 httpOnly Secure Cookie。' },
  { name: '本地临时敏感文件', status: 'warn', description: 'tmp/ 和 .env.local 已被 .gitignore 忽略，但本地 tmp 目录中仍有旧部署包、私钥和环境备份。', recommendation: '定期清理不再需要的 tmp 部署包；部署私钥继续只保存在忽略目录，不要提交。' },
];

/* 审计状态只映射语义色：通过 emerald、警告 amber、失败 --sf-danger。 */
const statusIcons: Record<AuditItem['status'], { icon: string; label: string; iconClass: string; chipClass: string }> = {
  pass: {
    icon: 'M5 13l4 4L19 7',
    label: '通过',
    iconClass: 'text-emerald-700 dark:text-emerald-300',
    chipClass: 'border-emerald-600/45 text-emerald-700 dark:border-emerald-400/45 dark:text-emerald-300',
  },
  warn: {
    icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
    label: '警告',
    iconClass: 'text-amber-700 dark:text-amber-300',
    chipClass: 'border-amber-600/45 text-amber-700 dark:border-amber-400/45 dark:text-amber-300',
  },
  fail: {
    icon: 'M6 18L18 6M6 6l12 12',
    label: '失败',
    iconClass: 'text-[var(--sf-danger)]',
    chipClass: 'border-[var(--sf-danger)] text-[var(--sf-danger)]',
  },
};

const PANEL =
  'min-w-0 overflow-hidden rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)]';
const CHIP =
  'inline-flex items-center rounded-[2px] border px-1.5 py-0.5 font-mono text-[10px] leading-none tracking-[0.08em]';
const TONE_VALUE: Record<AuditItem['status'], string> = {
  pass: 'text-emerald-700 dark:text-emerald-300',
  warn: 'text-amber-700 dark:text-amber-300',
  fail: 'text-[var(--sf-danger)]',
};

function Metric({ label, value, valueClassName }: { label: string; value: number; valueClassName: string }) {
  return (
    <div className={`${PANEL} px-3 py-2.5`}>
      <p className={`font-mono text-2xl font-bold leading-none tracking-tight tabular-nums ${valueClassName}`}>{value}</p>
      <p className="mt-1 break-words font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--sf-ink-3)] [overflow-wrap:anywhere]">{label}</p>
    </div>
  );
}

export default function SecurityAudit() {
  const passCount = auditItems.filter(i => i.status === 'pass').length;
  const warnCount = auditItems.filter(i => i.status === 'warn').length;
  const failCount = auditItems.filter(i => i.status === 'fail').length;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-w-0 space-y-4">
      <TotpManager />
      <SecurityStatus />
      <SecurityRatePolicyForm />

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="通过" value={passCount} valueClassName={TONE_VALUE.pass} />
        <Metric label="警告" value={warnCount} valueClassName={TONE_VALUE.warn} />
        <Metric label="失败" value={failCount} valueClassName={TONE_VALUE.fail} />
      </div>

      {/* 审计清单：细线行，状态图标 + 名称 + 说明 + 建议 */}
      <div className="min-w-0 border-t border-[var(--sf-line)]">
        {auditItems.map((item, index) => {
          const s = statusIcons[item.status];
          return (
            <motion.div
              key={item.name}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.03 }}
              className="max-w-full overflow-hidden border-b border-[var(--sf-line-soft)] px-1 py-3"
            >
              <div className="flex items-start gap-3">
                <svg className={`mt-0.5 h-4 w-4 shrink-0 ${s.iconClass}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={s.icon} />
                </svg>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <h3 className="break-words text-sm font-medium text-[var(--sf-ink)] [overflow-wrap:anywhere]">{item.name}</h3>
                    <span className={`${CHIP} ${s.chipClass}`}>[{s.label}]</span>
                    <span className="ml-auto font-mono text-[10px] tabular-nums tracking-[0.16em] text-[var(--sf-ink-3)]">{String(index + 1).padStart(2, '0')}</span>
                  </div>
                  <p className="break-words text-sm leading-relaxed text-[var(--sf-ink-2)] [overflow-wrap:anywhere]">{item.description}</p>
                  {item.status !== 'pass' && (
                    <p className="mt-2 break-words text-xs leading-relaxed text-[var(--sf-ink-2)] [overflow-wrap:anywhere]">
                      <strong className="font-semibold text-[var(--sf-ink)]">建议：</strong>
                      {item.recommendation}
                    </p>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}
