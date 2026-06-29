import React from 'react';
import { motion } from 'framer-motion';

interface AuditItem { name: string; status: 'pass' | 'warn' | 'fail'; description: string; recommendation: string; }

const auditItems: AuditItem[] = [
  { name: 'HTTPS 与 HSTS', status: 'pass', description: '公网入口由 1Panel OpenResty 提供 HTTPS，站点配置包含 HSTS。', recommendation: '' },
  { name: '登录接口限流', status: 'pass', description: 'OpenResty 对密码登录、管理员登录、OTP 请求和 OTP 校验接口启用按 IP 限流，超限返回 429。', recommendation: '' },
  { name: 'PocketBase 登录 Hook', status: 'pass', description: 'login_security.pb.js 保持禁用，避免破坏正确登录；登录防爆破前移到 OpenResty 层。', recommendation: '' },
  { name: 'PocketBase 管理端访问', status: 'pass', description: '/_/admin 由 Caddy 按 ADMIN_IP 白名单限制访问。', recommendation: '' },
  { name: '角色权限保护', status: 'pass', description: '后台菜单、页面守卫和 PocketBase 规则按作者、管理员、超级管理员分层控制。', recommendation: '' },
  { name: '用户角色写入保护', status: 'pass', description: 'guard_user_role.pb.js 强制普通注册只能成为普通用户，只有超级管理员可以提升角色。', recommendation: '' },
  { name: '评论审核', status: 'pass', description: '新评论默认进入待审核状态，前台仅读取已通过评论。', recommendation: '' },
  { name: '评论 XSS 防护', status: 'pass', description: '评论 hook 会去除 HTML 标签，前端展示评论时不使用 HTML 注入。', recommendation: '' },
  { name: '扫描路径拦截', status: 'pass', description: 'Caddy 拦截 .env、.git、wp-*、phpmyadmin、shell、config 等常见扫描路径。', recommendation: '' },
  { name: '安全响应头', status: 'pass', description: 'Caddy 设置 X-Frame-Options、X-Content-Type-Options、Referrer-Policy、Permissions-Policy 和 CSP。', recommendation: '' },
  { name: '认证 Token 存储', status: 'warn', description: 'PocketBase 默认把认证 token 放在浏览器 localStorage。当前后台每次加载会 authRefresh 校验并清理失效 token，但 XSS 场景下仍有被读取风险。', recommendation: '长期加固可考虑通过 Astro API 层代理认证，并改为 httpOnly Secure Cookie。' },
  { name: '本地临时敏感文件', status: 'warn', description: 'tmp/ 和 .env.local 已被 .gitignore 忽略，但本地 tmp 目录中仍有旧部署包、私钥和环境备份。', recommendation: '定期清理不再需要的 tmp 部署包；部署私钥继续只保存在忽略目录，不要提交。' },
];

const statusIcons: Record<string, { icon: string; color: string; label: string }> = {
  pass: { icon: 'M5 13l4 4L19 7', color: 'text-success', label: '通过' },
  warn: { icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z', color: 'text-warning', label: '警告' },
  fail: { icon: 'M6 18L18 6M6 6l12 12', color: 'text-danger', label: '失败' },
};

export default function SecurityAudit() {
  const passCount = auditItems.filter(i => i.status === 'pass').length;
  const warnCount = auditItems.filter(i => i.status === 'warn').length;
  const failCount = auditItems.filter(i => i.status === 'fail').length;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-w-0 space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card min-w-0 rounded-xl p-4 text-center"><p className="font-display text-2xl font-black text-success">{passCount}</p><p className="break-words font-mono text-[10px] uppercase tracking-widest text-muted [overflow-wrap:anywhere]">通过</p></div>
        <div className="card min-w-0 rounded-xl p-4 text-center"><p className="font-display text-2xl font-black text-warning">{warnCount}</p><p className="break-words font-mono text-[10px] uppercase tracking-widest text-muted [overflow-wrap:anywhere]">警告</p></div>
        <div className="card min-w-0 rounded-xl p-4 text-center"><p className="font-display text-2xl font-black text-danger">{failCount}</p><p className="break-words font-mono text-[10px] uppercase tracking-widest text-muted [overflow-wrap:anywhere]">失败</p></div>
      </div>
      <div className="space-y-3">
        {auditItems.map((item, index) => {
          const s = statusIcons[item.status];
          return (
            <motion.div key={item.name} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.03 }} className="card max-w-full overflow-hidden rounded-xl p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <svg className={'h-5 w-5 shrink-0 mt-0.5 ' + s.color} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={s.icon} /></svg>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2"><h3 className="break-words text-sm font-medium text-text [overflow-wrap:anywhere]">{item.name}</h3><span className={'font-mono text-[10px] uppercase ' + s.color}>[{s.label}]</span></div>
                  <p className="break-words text-sm text-text-secondary [overflow-wrap:anywhere]">{item.description}</p>
                  {item.status !== 'pass' && <p className="mt-2 break-words text-xs text-accent [overflow-wrap:anywhere]"><strong>建议：</strong>{item.recommendation}</p>}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}