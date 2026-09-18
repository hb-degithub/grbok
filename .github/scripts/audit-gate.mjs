#!/usr/bin/env node
// CI 依赖审计门禁:运行 `npm audit --omit=dev --json`,过滤 audit-allowlist.json 中
// 显式登记的条目(须含 reason 与 until 到期日,过期即重新变硬故障),
// 其余 high/critical 漏洞使进程以非零码退出(硬门禁)。
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const allowlistPath = path.join(here, '..', 'audit-allowlist.json');
const allowlist = JSON.parse(readFileSync(allowlistPath, 'utf8'));

const today = new Date().toISOString().slice(0, 10);
const activeAllow = {};
for (const [pkg, entry] of Object.entries(allowlist)) {
  if (entry && typeof entry.until === 'string' && entry.until >= today) {
    activeAllow[pkg] = entry;
  } else {
    console.warn(`[audit-gate] 允许清单条目已过期,恢复拦截: ${pkg} (until=${entry && entry.until})`);
  }
}

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
let raw;
try {
  raw = execFileSync(npmCmd, ['audit', '--omit=dev', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32', // Windows 需要 shell 才能执行 .cmd
  });
} catch (err) {
  // npm audit 发现漏洞时退出码为 1,stdout 仍带 JSON
  raw = err.stdout ? String(err.stdout) : '';
  if (!raw.trim()) {
    console.error('[audit-gate] npm audit 执行失败:', err.message);
    process.exit(2);
  }
}

const report = JSON.parse(raw);
const vulns = report.vulnerabilities || {};
const blocked = [];
const allowed = [];

for (const [pkg, info] of Object.entries(vulns)) {
  const severity = info.severity || 'info';
  if (severity !== 'high' && severity !== 'critical') continue;
  if (activeAllow[pkg]) {
    allowed.push(`${pkg} (${severity}) — 允许清单豁免: ${activeAllow[pkg].reason}`);
    continue;
  }
  blocked.push(`${pkg} (${severity}): ${(info.via || []).map((v) => (typeof v === 'string' ? v : v.title)).filter(Boolean).join('; ')}`);
}

for (const line of allowed) console.log(`[audit-gate] 豁免: ${line}`);

if (blocked.length) {
  console.error('[audit-gate] 发现未豁免的 high/critical 漏洞:');
  for (const line of blocked) console.error('  - ' + line);
  process.exit(1);
}
console.log('[audit-gate] 通过:无未豁免的 high/critical 漏洞');
