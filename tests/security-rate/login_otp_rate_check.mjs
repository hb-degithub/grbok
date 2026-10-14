#!/usr/bin/env node
// 2026-10-14 渗透测试 #5 / #7 / #9 修复的实跑验证驱动。
//
// 用途：在本机隔离的 PocketBase 0.22.21 实例上跑三组场景，产出"修复前(HEAD)/修复后"对照证据。
//   --mode fixed     只跑当前工作区
//   --mode baseline  只跑 git HEAD 版本（git archive 取出，绝不碰工作区 / 绝不 git stash）
//   --mode both      先 fixed 后 baseline（默认）
//
// 隔离约定（与父任务一致）：端口 18092、数据目录 tmp/pb-test-rate/、证据 tmp/pb-test-rate/evidence/。
// 不使用 npm/node --test，不写任何仓库文件（只写 tmp/）。

import { spawn, spawnSync } from 'node:child_process';
import { mkdir, rm, readFile, writeFile, cp, readdir } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

const PB = path.resolve(String(arg('pb', 'C:\\tmp\\pocketbase-v0.22.21\\pocketbase.exe')));
const PORT = Number(arg('port', 18092));
const ROOT = path.resolve(String(arg('root', path.join(REPO, 'tmp', 'pb-test-rate'))));
const MODE = String(arg('mode', 'both'));
const BASE = `http://127.0.0.1:${PORT}`;
const EVIDENCE = path.join(ROOT, 'evidence');

const ENV = {
  MAIL_HASH_SECRET: 'REPLACE_WITH_LOCAL_TEST_MAIL_HASH_SECRET',
  MAIL_INTERNAL_SECRET: 'REPLACE_WITH_LOCAL_TEST_MAIL_INTERNAL_SECRET',
  MAIL_GATEWAY_ENABLED: 'true',
  MAIL_ACCOUNT_ENABLED: 'true',
  MAIL_OTP_ENABLED: 'true',
  MAIL_GATEWAY_INTERNAL_URL: `http://127.0.0.1:${PORT}`,
  BLOG_AUTH_LOOPBACK_BASE: `http://127.0.0.1:${PORT}`,
  PUBLIC_SITE_URL: 'http://localhost:4321',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

async function http(method, urlPath, { body, headers = {}, timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(BASE + urlPath, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* 非 JSON 响应 */ }
    return { status: res.status, body: json, text: text.slice(0, 400) };
  } finally {
    clearTimeout(timer);
  }
}

class Pb {
  constructor(name) {
    this.name = name;
    this.child = null;
    this.logFile = path.join(EVIDENCE, `${name}-pocketbase.log`);
  }
  runDir() { return path.join(ROOT, this.name); }
  dataDir() { return path.join(this.runDir(), 'pb_data'); }
  hooksDir() { return path.join(this.runDir(), 'pb_hooks'); }
  migrationsDir() { return path.join(this.runDir(), 'pb_migrations'); }
  bootstrapDir() { return path.join(this.runDir(), '_bootstrap_empty'); }

  async start({ hooksDir, migrationsDir } = {}) {
    await mkdir(this.dataDir(), { recursive: true });
    const fd = openSync(this.logFile, 'a');
    const args = [
      'serve',
      `--dir=${this.dataDir()}`,
      `--hooksDir=${hooksDir || this.hooksDir()}`,
      `--migrationsDir=${migrationsDir || this.migrationsDir()}`,
      `--http=127.0.0.1:${PORT}`,
    ];
    await writeFile(this.logFile, `\n\n==== start ${new Date().toISOString()} ${args.join(' ')}\n`, { flag: 'a' });
    this.child = spawn(PB, args, {
      cwd: this.runDir(),
      env: { ...process.env, ...ENV },
      stdio: ['ignore', fd, fd],
      windowsHide: true,
    });
    const deadline = Date.now() + 40000;
    while (Date.now() < deadline) {
      if (this.child.exitCode !== null) {
        closeSync(fd);
        throw new Error(`PocketBase(${this.name}) exited early code=${this.child.exitCode}\n` + await readFile(this.logFile, 'utf8'));
      }
      try {
        const res = await http('GET', '/api/health', { timeoutMs: 1500 });
        if (res.status === 200) { closeSync(fd); return; }
      } catch { /* 还没起来 */ }
      await sleep(200);
    }
    closeSync(fd);
    throw new Error(`PocketBase(${this.name}) 未在 40s 内就绪\n` + await readFile(this.logFile, 'utf8'));
  }

  async stop() {
    if (!this.child || this.child.exitCode !== null) { this.child = null; return; }
    const pid = this.child.pid;
    try { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ignore */ }
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && this.child.exitCode === null) await sleep(150);
    this.child = null;
  }
}

// 端口独占守卫：18092 只允许本驱动使用；若有其它 pocketbase 占着就杀掉（同目录独占约定）
function freePort() {
  const out = spawnSync('powershell', ['-NoProfile', '-Command',
    `(Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue).OwningProcess`],
    { encoding: 'utf8' });
  const pids = String(out.stdout || '').split(/\s+/).filter((v) => /^\d+$/.test(v));
  for (const pid of pids) {
    const name = spawnSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).ProcessName`], { encoding: 'utf8' }).stdout.trim();
    if (name.toLowerCase() === 'pocketbase') {
      log(`  端口 ${PORT} 被 pocketbase ${pid} 占用，先释放`);
      spawnSync('taskkill', ['/PID', pid, '/T', '/F'], { stdio: 'ignore' });
    } else {
      throw new Error(`端口 ${PORT} 被非 pocketbase 进程占用: ${pid} (${name})`);
    }
  }
}

async function verifyPrepared(pb) {
  const must = [
    ['fixture', path.join(pb.hooksDir(), 'security_rate_fixture.pb.js')],
    ['login_security_lib', path.join(pb.hooksDir(), 'lib', 'login_security_lib.js')],
    ['stats_lib', path.join(pb.hooksDir(), 'lib', 'stats_lib.js')],
    ['security_policy_store', path.join(pb.hooksDir(), 'lib', 'security_policy_store.js')],
  ];
  const missing = [];
  for (const [label, file] of must) {
    try { await readFile(file); } catch { missing.push(`${label}:${file}`); }
  }
  if (missing.length) throw new Error('hooks 目录准备不完整:\n  ' + missing.join('\n  '));
  const hooks = await readdir(pb.hooksDir());
  const migrations = await readdir(pb.migrationsDir());
  log(`  prepare ok: pb_hooks=${hooks.length} entries, pb_migrations=${migrations.length} entries`);
}

// 全新数据目录必须先以空 hooks/迁移目录引导一次，否则迁移 001 报 no such table: _collections
async function bootstrap(name) {
  const pb = new Pb(name);
  await rm(pb.dataDir(), { recursive: true, force: true });
  await mkdir(pb.bootstrapDir(), { recursive: true });
  await mkdir(pb.dataDir(), { recursive: true });
  await pb.start({ hooksDir: pb.bootstrapDir(), migrationsDir: pb.bootstrapDir() });
  await pb.stop();
  return pb;
}

async function copyTree(src, dest) {
  await mkdir(dest, { recursive: true });
  for (const entry of await readdir(src, { withFileTypes: true })) {
    await cp(path.join(src, entry.name), path.join(dest, entry.name), { recursive: true, force: true });
  }
}

// 从 git HEAD 取出 hooks/迁移（不回滚工作区、不 git stash —— 其它子代理正并行改文件）
async function materializeHead(tarPath, dest) {
  await mkdir(dest, { recursive: true });
  const archive = spawnSync('git', ['-C', REPO, 'archive', '--format=tar', '-o', tarPath, 'HEAD', 'pb_hooks', 'pb_migrations'], { encoding: 'utf8' });
  if (archive.status !== 0) throw new Error('git archive failed: ' + archive.stderr);
  const untar = spawnSync('tar', ['-xf', tarPath, '-C', dest], { encoding: 'utf8' });
  if (untar.status !== 0) throw new Error('tar failed: ' + untar.stderr);
}

// ---------------------------------------------------------------- 场景

function verdictOf(res) {
  const msg = String((res.body && res.body.message) || '');
  if (res.status === 200) return 'OK(200)';
  if (msg.includes('登录尝试过于频繁')) return 'RATE_LIMITED(400)';
  if (/Failed to authenticate/i.test(msg)) return 'BAD_CREDENTIALS(400)';
  if (res.status === 429) return 'RATE_LIMITED(429)';
  return `${res.status}:${msg.slice(0, 48) || res.text.slice(0, 48)}`;
}

function shortVerdict(res) {
  const v = verdictOf(res);
  if (v === 'OK(200)') return 'OK';
  if (v === 'RATE_LIMITED(400)') return 'LIMIT400';
  if (v === 'RATE_LIMITED(429)') return 'LIMIT429';
  if (v === 'BAD_CREDENTIALS(400)') return 'BAD400';
  return v;
}

function login(ip, identity, password) {
  return http('POST', '/api/collections/users/auth-with-password', {
    body: { identity, password },
    headers: { 'ali-real-client-ip': ip },
  });
}

function adminLogin(ip, identity, password) {
  return http('POST', '/api/admins/auth-with-password', {
    body: { identity, password },
    headers: { 'ali-real-client-ip': ip },
  });
}

async function api(pathname, opts) { return http('GET', pathname, opts); }

async function buckets(ip, email) {
  const q = new URLSearchParams();
  if (ip) q.set('ip', ip);
  if (email) q.set('email', email);
  const res = await http('GET', '/api/test/login-rate/buckets?' + q.toString());
  return res.body;
}

async function scenarioLogin(pb, out) {
  const user = { email: 'rate-probe@example.com', password: 'Test12345!' };
  out.setup.seedUser = await http('POST', '/api/test/login-rate/seed-user', { body: user });
  await http('POST', '/api/test/login-rate/reset');

  const ip = '203.0.113.10';
  const attempts = [];
  for (let i = 1; i <= 12; i++) {
    const res = await login(ip, user.email, 'wrong-password');
    attempts.push({ n: i, status: res.status, verdict: shortVerdict(res), message: String((res.body && res.body.message) || '').slice(0, 80) });
  }
  out.usersChain = {
    attempts,
    firstLimitedAt: (attempts.find((a) => a.verdict === 'LIMIT400') || {}).n || null,
    bucketsAfter: await buckets(ip, user.email),
  };

  // ---- 重启 PB（同一数据目录），验证计数是否持久化
  await pb.stop();
  await pb.start();
  const afterRestart = await login(ip, user.email, 'wrong-password');
  out.usersChain.afterRestart = {
    status: afterRestart.status,
    verdict: shortVerdict(afterRestart),
    message: String((afterRestart.body && afterRestart.body.message) || '').slice(0, 80),
    buckets: await buckets(ip, user.email),
  };
  // 换一个 IP + 正确口令：证明限流没有把正常登录打死（且成功后清零）
  const fresh = await login('203.0.113.99', user.email, user.password);
  out.usersChain.correctLoginFreshIp = {
    status: fresh.status,
    verdict: shortVerdict(fresh),
    hasToken: Boolean(fresh.body && fresh.body.token),
    bucketsAfterSuccess: await buckets('203.0.113.99', user.email),
    originBucketsAfterSuccess: await buckets(ip, user.email),
  };
}

async function scenarioSpray(pb, out) {
  await http('POST', '/api/test/login-rate/reset');
  const ip = '203.0.113.20';
  const rows = [];
  for (let i = 0; i < 12; i++) {
    const identity = `spray-${i}@example.com`;
    const res = await login(ip, identity, 'wrong-password');
    rows.push({ n: i + 1, identity, status: res.status, verdict: shortVerdict(res) });
  }
  out.spray = {
    rows,
    firstLimitedAt: (rows.find((r) => r.verdict === 'LIMIT400') || {}).n || null,
    ipBucket: (await buckets(ip, ''))?.counts?.login_ip ?? null,
  };
}

async function scenarioAdmin(pb, out) {
  const admin = { email: 'rate-admin@example.com', password: 'Admin12345!' };
  out.setup.seedAdmin = await http('POST', '/api/test/login-rate/seed-admin', { body: admin });
  await http('POST', '/api/test/login-rate/reset');
  const ip = '203.0.113.30';
  const rows = [];
  for (let i = 1; i <= 7; i++) {
    const res = await adminLogin(ip, admin.email, 'wrong-password');
    rows.push({ n: i, status: res.status, verdict: shortVerdict(res) });
  }
  const fresh = await adminLogin('203.0.113.31', admin.email, admin.password);
  out.adminChain = {
    rows,
    firstLimitedAt: (rows.find((r) => r.verdict === 'LIMIT400') || {}).n || null,
    correctLoginFreshIp: { status: fresh.status, verdict: shortVerdict(fresh), hasToken: Boolean(fresh.body && fresh.body.token) },
  };
}

async function scenarioOtp(pb, out) {
  const email = 'otp-reader@example.com';
  await http('POST', '/api/test/login-rate/seed-user', { body: { email, password: 'Test12345!' } });
  await http('POST', '/api/test/login-rate/reset');
  const out2 = {};

  // (a) 未触发限流时正确码必须成功
  const c1 = 'rateotpchallengeA00000000000001';
  out.setup.seedOtpA = await http('POST', '/api/test/login-rate/seed-otp', { body: { email, code: '123456', challengeId: c1 } });
  const ok = await http('POST', '/api/blog-auth/otp/verify', { body: { challengeId: c1, code: '123456' }, headers: { 'ali-real-client-ip': '203.0.113.40' } });
  out2.happyPath = {
    status: ok.status,
    hasToken: Boolean(ok.body && ok.body.token),
    challenge: (await api('/api/test/login-rate/challenge?challengeId=' + c1)).body,
  };
  // 复用同一条已被消费的 challenge：仍应 400（"成功即作废"语义未变）
  const replay = await http('POST', '/api/blog-auth/otp/verify', { body: { challengeId: c1, code: '123456' }, headers: { 'ali-real-client-ip': '203.0.113.40' } });
  out2.replayConsumed = { status: replay.status, body: replay.body };

  // (b) 同一 IP 连续错误提交直到 429
  const ip = '203.0.113.41';
  const c2 = 'rateotpchallengeB00000000000002';
  out.setup.seedOtpB = await http('POST', '/api/test/login-rate/seed-otp', { body: { email, code: '654321', challengeId: c2 } });
  const bad = [];
  let first429 = null;
  let limitedBody = null;
  for (let i = 1; i <= 26; i++) {
    const res = await http('POST', '/api/blog-auth/otp/verify', { body: { challengeId: c2, code: '000000' }, headers: { 'ali-real-client-ip': ip } });
    const row = { n: i, status: res.status, code: res.body && res.body.code ? res.body.code : null };
    bad.push(row);
    if (res.status === 429 && first429 === null) { first429 = i; limitedBody = res.body; }
  }
  out2.wrongCodeFlood = {
    ip,
    total: bad.length,
    first429At: first429,
    limitedResponseBody: limitedBody,
    statuses: bad.map((r) => `${r.n}:${r.status}`).join(','),
    challengeAfter: (await api('/api/test/login-rate/challenge?challengeId=' + c2)).body,
    ipBucket: (await buckets(ip, ''))?.counts?.otp_verify_ip ?? null,
  };

  // (c) 限流是 per-IP 的：另一个 IP 的正确码仍成功
  const c3 = 'rateotpchallengeC00000000000003';
  await http('POST', '/api/test/login-rate/seed-otp', { body: { email, code: '999999', challengeId: c3 } });
  const other = await http('POST', '/api/blog-auth/otp/verify', { body: { challengeId: c3, code: '999999' }, headers: { 'ali-real-client-ip': '203.0.113.42' } });
  out2.otherIpStillWorks = { status: other.status, hasToken: Boolean(other.body && other.body.token) };

  // (d) 已被限流的 IP 用正确码也应 429（限流先于 challenge 判定）
  const c4 = 'rateotpchallengeD00000000000004';
  await http('POST', '/api/test/login-rate/seed-otp', { body: { email, code: '111222', challengeId: c4 } });
  const limitedCorrect = await http('POST', '/api/blog-auth/otp/verify', { body: { challengeId: c4, code: '111222' }, headers: { 'ali-real-client-ip': ip } });
  out2.limitedIpCorrectCode = { status: limitedCorrect.status, body: limitedCorrect.body };

  out.otp = out2;
}

const PATH_CASES = [
  // [path, 期望修复后]
  ['/posts/hello-world', true],
  ['/posts/hello-world/', true],
  ['/tags/%E4%B8%AD%E6%96%87', true],
  ['/tags/中文', true],
  ['/', true],
  ['/posts/2026-10-14-a-b_c.d~e', true],
  ["/posts/it's-fine", true],
  ['/posts/a,b;c=d(e)f', true],
  ['/<b>hi</b>', false],
  ['/posts/<script>alert(1)</script>', false],
  ['/\u0000', false],
  ['/posts/\u0000abc', false],
  ['/posts/a\tb', false],
  ['/posts/a\u007fb', false],
  ['/posts/a b', false],
  ['//evil.example.com/x', false],
  ['/posts/../../etc/passwd', false],
  ['/posts/a\\b', false],
  ['/posts/%zz', false],
  ['/posts/a"b', false],
  ['/posts/' + 'a'.repeat(500), false],
];

async function scenarioTrackView(pb, out) {
  await http('POST', '/api/test/login-rate/reset-views');
  const ip = '203.0.113.50';
  const rows = [];
  for (const [p, expect] of PATH_CASES) {
    const res = await http('POST', '/api/track-view', { body: { path: p, referrer: 'https://example.com/x' }, headers: { 'ali-real-client-ip': ip } });
    const stored = await api('/api/test/login-rate/views?path=' + encodeURIComponent(p));
    rows.push({
      path: p.length > 60 ? p.slice(0, 57) + '...' : JSON.stringify(p),
      status: res.status,
      error: res.body && res.body.error ? res.body.error : null,
      storedRows: stored.body ? stored.body.matches : null,
      expectAfterFix: expect,
      verdict: res.status === 202 ? 'ACCEPT' : 'REJECT',
    });
  }
  const stats = await api('/api/blog-stats');
  const topPages = (stats.body && stats.body.topPages) || [];
  out.trackView = {
    rows,
    rejectedAfterFixStillStored: rows.filter((r) => r.expectAfterFix === false && r.storedRows > 0).map((r) => r.path),
    acceptedAfterFixNotStored: rows.filter((r) => r.expectAfterFix === true && r.storedRows === 0).map((r) => r.path),
    totalStored: (await api('/api/test/login-rate/views?path=/')).body.total,
    topPages: topPages.map((t) => ({ path: t.path, views: t.views })),
  };
}

async function scenarioPathTable(pb, out) {
  const res = await http('POST', '/api/test/login-rate/paths', { body: { paths: PATH_CASES.map(([p]) => p) } });
  if (!res.body || !res.body.results) {
    out.pathTable = { available: false, note: 'stats_lib.isValidPath 未导出（修复前基线）', expectAfterFix: PATH_CASES.map(([p, e]) => ({ path: p, expect: e })) };
    return;
  }
  out.pathTable = {
    available: true,
    maxPathLength: res.body.maxPathLength,
    results: res.body.results.map((r, i) => ({ path: JSON.stringify(r.path), accepted: r.accepted, expectAfterFix: PATH_CASES[i][1] })),
    mismatches: res.body.results.filter((r, i) => r.accepted !== PATH_CASES[i][1]).map((r) => r.path),
  };
}

// ---------------------------------------------------------------- 主流程

async function runMode(mode) {
  const pb = new Pb(mode);
  log(`\n================ ${mode.toUpperCase()} ================`);
  freePort();
  await rm(pb.hooksDir(), { recursive: true, force: true });
  await rm(pb.migrationsDir(), { recursive: true, force: true });
  if (mode === 'fixed') {
    await bootstrap(mode);
    await copyTree(path.join(REPO, 'pb_hooks'), pb.hooksDir());
    await copyTree(path.join(REPO, 'pb_migrations'), pb.migrationsDir());
  } else {
    await bootstrap(mode);
    const headDir = path.join(ROOT, 'head-src');
    await rm(headDir, { recursive: true, force: true });
    await materializeHead(path.join(ROOT, 'head-pb.tar'), headDir);
    await copyTree(path.join(headDir, 'pb_hooks'), pb.hooksDir());
    await copyTree(path.join(headDir, 'pb_migrations'), pb.migrationsDir());
  }
  await cp(path.join(REPO, 'tests', 'security-rate', 'login_otp_rate_fixture.pb.js'), path.join(pb.hooksDir(), 'security_rate_fixture.pb.js'), { force: true });
  await verifyPrepared(pb);
  await pb.start();

  const out = { mode, startedAt: new Date().toISOString() };
  const health = await http('GET', '/api/health');
  out.health = health.status;
  const policy = await http('GET', '/api/test/login-rate/policy');
  out.policy = policy.body;
  out.setup = {};

  const steps = [
    ['login', scenarioLogin],
    ['spray', scenarioSpray],
    ['admin', scenarioAdmin],
    ['otp', scenarioOtp],
    ['trackView', scenarioTrackView],
    ['pathTable', scenarioPathTable],
  ];
  for (const [name, fn] of steps) {
    try {
      await fn(pb, out);
    } catch (error) {
      out[`error_${name}`] = String(error && error.stack ? error.stack : error);
      log(`  !! ${name} 场景抛错: ${error && error.message ? error.message : error}`);
    }
  }

  await pb.stop();
  out.finishedAt = new Date().toISOString();
  await writeFile(path.join(EVIDENCE, `${mode}-result.json`), JSON.stringify(out, null, 2));
  return out;
}

function table(rows) {
  for (const r of rows) log('  ' + r.join(' | '));
}

function report(fixed, baseline) {
  log('\n\n================= 对照摘要 =================');
  if (fixed) {
    log('\n[#5 users 链路] 修复后：同 IP 同邮箱连续错误口令');
    table(fixed.usersChain.attempts.map((a) => [`#${a.n}`, a.verdict, a.message]));
    log(`  首次被限流于第 ${fixed.usersChain.firstLimitedAt} 次`);
    log('  桶计数(修复后): ' + JSON.stringify(fixed.usersChain.bucketsAfter.counts));
    log(`  重启 PB 后再试一次 -> ${fixed.usersChain.afterRestart.verdict} / ${fixed.usersChain.afterRestart.message}`);
    log('  重启后桶计数: ' + JSON.stringify(fixed.usersChain.afterRestart.buckets.counts));
    log(`  换 IP + 正确口令 -> ${fixed.usersChain.correctLoginFreshIp.verdict} token=${fixed.usersChain.correctLoginFreshIp.hasToken}`);
    log(`[#5 口令喷洒] 首次限流 #${fixed.spray.firstLimitedAt}（换不同邮箱同 IP），login_ip 桶=${fixed.spray.ipBucket}`);
    log(`[#5 admins 链路] 首次限流 #${fixed.adminChain.firstLimitedAt}，换 IP 正确口令 -> ${fixed.adminChain.correctLoginFreshIp.verdict}`);
    log(`[#7 OTP] 正例=${fixed.otp.happyPath.status} 复用已消费 challenge=${fixed.otp.replayConsumed.status}`);
    log(`[#7 OTP] 错码洪泛首次 429 于第 ${fixed.otp.wrongCodeFlood.first429At} 次；响应体=${JSON.stringify(fixed.otp.wrongCodeFlood.limitedResponseBody)}`);
    log(`[#7 OTP] challenge 5 次后状态=${JSON.stringify(fixed.otp.wrongCodeFlood.challengeAfter)}；otp_verify_ip 桶=${fixed.otp.wrongCodeFlood.ipBucket}`);
    log(`[#7 OTP] 换 IP 正确码=${fixed.otp.otherIpStillWorks.status}；被限 IP 正确码=${fixed.otp.limitedIpCorrectCode.status}`);
    log(`[#9 track-view] 修复后仍落库的非法样本=${JSON.stringify(fixed.trackView.rejectedAfterFixStillStored)}；应通过却未落库=${JSON.stringify(fixed.trackView.acceptedAfterFixNotStored)}`);
    log('  topPages=' + JSON.stringify(fixed.trackView.topPages.slice(0, 8)));
    log(`  isValidPath 判定表失配=${JSON.stringify(fixed.pathTable.mismatches || fixed.pathTable.note)}`);
  }
  if (baseline) {
    log('\n[#5 HEAD 基线] 同 IP 同邮箱连续错误口令');
    table(baseline.usersChain.attempts.map((a) => [`#${a.n}`, a.verdict, a.message]));
    log(`  首次被限流于第 ${baseline.usersChain.firstLimitedAt} 次`);
    log('  桶计数(基线, 持久表里应恒为 0): ' + JSON.stringify(baseline.usersChain.bucketsAfter.counts));
    log(`  重启 PB 后再试一次 -> ${baseline.usersChain.afterRestart.verdict} / ${baseline.usersChain.afterRestart.message}   <== 内存桶清零证据`);
    log(`[#5 口令喷洒] 首次限流 #${baseline.spray.firstLimitedAt}`);
    log(`[#5 admins 链路] 首次限流 #${baseline.adminChain.firstLimitedAt}`);
    log(`[#7 OTP] 错码洪泛首次 429 于第 ${baseline.otp.wrongCodeFlood.first429At} 次（null = 全程无 429）`);
    log(`[#7 OTP] challenge 状态=${JSON.stringify(baseline.otp.wrongCodeFlood.challengeAfter)}`);
    log(`[#9 track-view] 基线被接受并落库的非法样本=${JSON.stringify(baseline.trackView.rows.filter((r) => r.verdict === 'ACCEPT' && r.expectAfterFix === false).map((r) => r.path))}`);
    log('  基线 topPages=' + JSON.stringify(baseline.trackView.topPages.slice(0, 8)));
  }
  if (fixed && baseline) {
    log('\n[对照表] 同一路径样本');
    const byPath = new Map(baseline.trackView.rows.map((r) => [r.path, r]));
    table(fixed.trackView.rows.map((r) => {
      const b = byPath.get(r.path);
      return [r.path, `HEAD=${b ? b.status : '?'}`, `修复后=${r.status}`, r.error || ''];
    }));
  }
}

async function main() {
  await mkdir(EVIDENCE, { recursive: true });
  const head = spawnSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const dirty = spawnSync('git', ['-C', REPO, 'status', '--porcelain'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  log(`repo=${REPO}\nPB=${PB}\nport=${PORT}\nroot=${ROOT}\nHEAD=${head}\ndirty files=${dirty.length}`);
  await writeFile(path.join(EVIDENCE, 'repo-state.json'), JSON.stringify({ head, dirty, pb: PB, port: PORT, at: new Date().toISOString() }, null, 2));

  let fixed = null;
  let baseline = null;
  if (MODE === 'fixed' || MODE === 'both') fixed = await runMode('fixed');
  if (MODE === 'baseline' || MODE === 'both') baseline = await runMode('baseline');
  report(fixed, baseline);
  log('\n证据目录: ' + EVIDENCE);
}

main().catch(async (error) => {
  console.error('DRIVER FAILED:', error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
