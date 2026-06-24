import React from 'react';
import { motion } from 'framer-motion';

interface AuditItem { name: string; status: 'pass' | 'warn' | 'fail'; description: string; recommendation: string; }

const auditItems: AuditItem[] = [
  { name: 'HTTPS Enforcement', status: 'pass', description: 'Production Caddy config enables ACME TLS and HSTS.', recommendation: '' },
  { name: 'Insecure PB URL Guard', status: 'pass', description: 'The frontend blocks non-local http:// PocketBase URLs in production builds.', recommendation: '' },
  { name: 'Content Security Policy', status: 'pass', description: 'Caddy sets a CSP with frame-ancestors none and upgrade-insecure-requests.', recommendation: '' },
  { name: 'Admin UI Access', status: 'pass', description: 'PocketBase /_/admin is denied unless the request IP matches ADMIN_IP.', recommendation: '' },
  { name: 'Comment Moderation', status: 'pass', description: 'New comments are created as pending and must be approved in the admin panel.', recommendation: '' },
  { name: 'Comment XSS Protection', status: 'pass', description: 'Public comments render as text, search excerpts use DOMPurify, and email hooks escape HTML.', recommendation: '' },
  { name: 'Rate Limiting', status: 'pass', description: 'Caddy API rate limiting is configured and comment submit has a small client limiter.', recommendation: '' },
  { name: 'SMTP Security', status: 'pass', description: 'The msmtp template uses TLS with SMTPS port 465 and environment-provided credentials.', recommendation: '' },
  { name: 'Server Header Hiding', status: 'pass', description: 'Caddy removes Server and X-Powered-By headers.', recommendation: '' },
  { name: 'Auth Token Storage', status: 'warn', description: 'PocketBase stores auth tokens in browser localStorage by default.', recommendation: 'For a hardened production admin, proxy auth through secure httpOnly cookies.' },
  { name: 'PB_ENCRYPTION_KEY', status: 'warn', description: '.env.local contains a local test key; production must use a unique generated key.', recommendation: 'Generate with openssl rand -hex 32 and never commit real values.' },
  { name: 'Public Comment Privacy', status: 'warn', description: 'The frontend requests only public comment fields, but PocketBase rules must also hide email/IP.', recommendation: 'Use PocketBase field hiding or a public_comments view/proxy for anonymous reads.' },
];

const statusIcons: Record<string, { icon: string; color: string }> = {
  pass: { icon: 'M5 13l4 4L19 7', color: 'text-success' },
  warn: { icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z', color: 'text-warning' },
  fail: { icon: 'M6 18L18 6M6 6l12 12', color: 'text-danger' },
};

export default function SecurityAudit() {
  const passCount = auditItems.filter(i => i.status === 'pass').length;
  const warnCount = auditItems.filter(i => i.status === 'warn').length;
  const failCount = auditItems.filter(i => i.status === 'fail').length;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card rounded-xl p-4 text-center"><p className="font-display text-2xl font-black text-success">{passCount}</p><p className="font-mono text-[10px] uppercase tracking-widest text-muted">Passed</p></div>
        <div className="card rounded-xl p-4 text-center"><p className="font-display text-2xl font-black text-warning">{warnCount}</p><p className="font-mono text-[10px] uppercase tracking-widest text-muted">Warnings</p></div>
        <div className="card rounded-xl p-4 text-center"><p className="font-display text-2xl font-black text-danger">{failCount}</p><p className="font-mono text-[10px] uppercase tracking-widest text-muted">Failed</p></div>
      </div>
      <div className="space-y-3">
        {auditItems.map((item, index) => {
          const s = statusIcons[item.status];
          return (
            <motion.div key={item.name} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.03 }} className="card rounded-xl p-5">
              <div className="flex items-start gap-3">
                <svg className={'h-5 w-5 shrink-0 mt-0.5 ' + s.color} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={s.icon} /></svg>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1"><h3 className="font-medium text-text text-sm">{item.name}</h3><span className={'font-mono text-[10px] uppercase ' + s.color}>[{item.status}]</span></div>
                  <p className="text-sm text-text-secondary">{item.description}</p>
                  {item.status !== 'pass' && <p className="mt-2 text-xs text-accent"><strong>Recommendation:</strong> {item.recommendation}</p>}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}
