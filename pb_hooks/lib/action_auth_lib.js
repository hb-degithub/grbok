'use strict';

// 文章/评论互动（点赞、收藏）的鉴权与限流公共逻辑。
//
// 背景（2026-10-14 外部渗透测试 #3）：
//   原实现把去重键定义为「ESA 边缘 IP + User-Agent」，并对匿名开放。
//   ESA 边缘 IP 在 NAT/CDN 回源下是共享的，攻击者换一次边缘 IP 或改一次
//   User-Agent 就能对同一篇文章重复 +1，去重形同虚设。
//   因此本模块把「谁在操作」的判定从网络信号改为**已认证用户身份**，
//   IP / User-Agent / 浏览器指纹一律降级为辅助信号（限流与留痕），
//   绝不参与授权判定。
//
// PB 0.22 JSVM 约束：
//   1. lib/*.js 内必须相对路径 require（绝对路径会抛 Invalid module）；
//   2. routerAdd 自定义路由里 e.auth 可能为空，必须走 security_status_lib.js
//      已验证的 resolveAuth 回退链（e.auth → $apis.requestInfo → e.get）。

var rateLimit = require('./security_rate_limit.js');

// 用户维度策略键。键名与阈值必须与 security_policy_store.js 的
// DEFAULTS/BOUNDS 完全一致；策略行由配套迁移注册。
// 若策略行缺失（security_policy_store.js 未同步 → 策略集整体 degraded），
// 本模块回退到 fallbackPolicyKey（既有的 IP 维度键），保证代码先上线也
// 不会让互动接口整体 503，同时绝不会「无限制放行」。
var USER_POLICY_KEYS = {
  post_like_user: { fallbackKey: 'post_like_ip', scope: 'post_like' },
  post_bookmark_user: { fallbackKey: 'post_bookmark_ip', scope: 'post_bookmark' },
  comment_like_user: { fallbackKey: 'comment_like_ip', scope: 'comment_like' },
};

// 指纹异常收紧：同一账号 60 秒窗口内出现 ≥3 个不同浏览器指纹时，
// 追加一次 IP 维度限流（更紧），并在响应体里给出 anomaly 标记。
var FINGERPRINT_ANOMALY_WINDOW_MS = 60000;
var FINGERPRINT_ANOMALY_DISTINCT = 3;
var FINGERPRINT_TRACE_TTL_MS = 600000;
var FINGERPRINT_TRACE_MAX_ENTRIES = 5000;

var MAX_FINGERPRINT_LENGTH = 128;

// PB 0.22 自定义路由不填充 e.auth（恒为 null），但鉴权中间件会把记录写进
// 请求上下文；回退链与 security_status_lib.js:9 的 resolveAuth 保持一致。
function resolveAuth(e) {
  try {
    if (e.auth && e.auth.id) return e.auth;
  } catch (_) {}
  try {
    var info = $apis.requestInfo(e);
    if (info && info.auth && info.auth.id) return info.auth;
    if (info && info.authRecord && info.authRecord.id) return info.authRecord;
  } catch (_) {}
  try {
    var record = e.get('authRecord') || e.get('auth');
    if (record && record.id) return record;
  } catch (_) {}
  return null;
}

function currentUser(e) {
  var auth = resolveAuth(e);
  if (!auth || !auth.id) return null;
  return auth;
}

function clientIp(e) {
  try {
    return rateLimit.normalizeIp(require('./client_ip.js').clientIp(e));
  } catch (_) {
    return 'unknown';
  }
}

function header(e, name) {
  try {
    return String(e.request().header.get(name) || '').trim();
  } catch (_) {
    return '';
  }
}

// 浏览器指纹：仅作辅助信号（限流收紧 + 留痕），绝不是授权依据。
// 前端目前只在 admin step-up 请求里发送该头（astro/src/lib/admin-step-up.ts:108），
// 返回的 present 字段用于观测前端覆盖进度。
function clientFingerprint(e) {
  var raw = header(e, 'X-Browser-Fingerprint');
  if (!raw) return { value: '', present: false };
  if (raw.length > MAX_FINGERPRINT_LENGTH) raw = raw.slice(0, MAX_FINGERPRINT_LENGTH);
  if (!/^[A-Za-z0-9._:-]+$/.test(raw)) return { value: '', present: false };
  return { value: raw, present: true };
}

/**
 * 要求已认证用户。匿名请求抛 401，响应体给出前端可识别的原因。
 * message 与 data.code 同时给出（前端按 code 判断，不解析文案）。
 */
function requireUser(e) {
  var user = currentUser(e);
  if (user) return user;
  var data = { code: new ValidationError('AUTH_REQUIRED', 'AUTH_REQUIRED') };
  throw new ApiError(401, 'AUTH_REQUIRED', data);
}

function actionUnavailable() {
  var data = { code: new ValidationError('ACTION_UNAVAILABLE', 'ACTION_UNAVAILABLE') };
  return new ApiError(503, 'ACTION_UNAVAILABLE', data);
}

function actionRateLimited(code, retryAfter) {
  var data = { code: new ValidationError(code, code) };
  if (retryAfter) data.retryAfter = new ValidationError('RETRY_AFTER', String(retryAfter));
  return new ApiError(429, code, data);
}

// consume() 对未注册的 policyKey 抛 InvalidRateLimitInputError（invalid()），
// 对整体降级的策略集抛 RateLimitUnavailableError。只把前者当作「键未注册」
// 做降级，其余错误一律 fail closed（503）。
function isUnknownPolicyError(error) {
  try {
    return Boolean(error) && error.name === 'InvalidRateLimitInputError';
  } catch (_) {
    return false;
  }
}

function consumeOnce(entries) {
  var decision;
  $app.dao().runInTransaction(function (txDao) {
    decision = rateLimit.consume(txDao, { nowMs: Date.now(), entries: entries });
  });
  if (!decision || typeof decision.allowed !== 'boolean') throw new Error('invalid rate decision');
  return decision;
}

/**
 * 持久化限流。优先「用户维度」策略，键缺失时回退到既有 IP 维度策略。
 *
 * @returns {{allowed:boolean, retryAfterSeconds:number, policyKey:string, degraded:boolean}}
 */
function checkRateLimit(options) {
  var userPolicyKey = String(options.userPolicyKey || '');
  var userSubject = String(options.userSubject || '');
  var fallbackPolicyKey = String(options.fallbackPolicyKey || '');
  var scope = String(options.scope || 'default');
  var ip = String(options.ip || 'unknown');
  var decision = null;
  var usedKey = userPolicyKey;
  var degraded = false;

  if (userPolicyKey && userSubject) {
    try {
      decision = consumeOnce([{ policyKey: userPolicyKey, subject: userSubject }]);
    } catch (error) {
      if (isUnknownPolicyError(error)) {
        degraded = true;
        decision = null;
      } else {
        throw actionUnavailable();
      }
    }
  }

  if (!decision) {
    usedKey = fallbackPolicyKey;
    try {
      decision = consumeOnce([{
        policyKey: fallbackPolicyKey,
        subject: 'action:' + scope + ':' + ip,
      }]);
    } catch (_) {
      throw actionUnavailable();
    }
  }

  return {
    allowed: decision.allowed,
    retryAfterSeconds: Number(decision.retryAfterSeconds) || 0,
    policyKey: usedKey,
    degraded: degraded,
  };
}

function pruneFingerprintTraces(store, now) {
  var removed = 0;
  for (var key in store) {
    if (!Object.prototype.hasOwnProperty.call(store, key)) continue;
    var trace = store[key];
    var stamp = Number((trace && trace.updatedAt) || 0);
    if (!stamp || now - stamp > FINGERPRINT_TRACE_TTL_MS) {
      delete store[key];
      removed++;
    }
  }
  return removed;
}

function fingerprintStore() {
  var store = globalThis.actionFingerprintTraces;
  if (!store) {
    store = {};
    globalThis.actionFingerprintTraces = store;
  }
  return store;
}

function countKeys(object) {
  var count = 0;
  for (var key in object) {
    if (Object.prototype.hasOwnProperty.call(object, key)) count++;
  }
  return count;
}

/**
 * 指纹异常检测（辅助信号，不是授权依据）。
 * 命中时返回用于追加限流的 IP 维度策略键，未命中返回 ''。
 */
function fingerprintAnomalyKey(userId, policyKey) {
  var fallbackKey = USER_POLICY_KEYS[policyKey] ? USER_POLICY_KEYS[policyKey].fallbackKey : '';
  if (!fallbackKey || !userId) return '';
  try {
    var store = fingerprintStore();
    var now = Date.now();
    if (countKeys(store) > FINGERPRINT_TRACE_MAX_ENTRIES) pruneFingerprintTraces(store, now);

    var trace = store[userId];
    if (!trace || now - Number(trace.windowStart || 0) > FINGERPRINT_ANOMALY_WINDOW_MS) {
      trace = { windowStart: now, distinct: {}, updatedAt: now };
    }
    var distinct = trace.distinct || {};
    if (trace.pendingFingerprint) distinct[String(trace.pendingFingerprint)] = 1;
    trace.distinct = distinct;
    trace.updatedAt = now;
    trace.pendingFingerprint = '';
    store[userId] = trace;

    return countKeys(distinct) >= FINGERPRINT_ANOMALY_DISTINCT ? fallbackKey : '';
  } catch (_) {
    return '';
  }
}

// 记录指纹观测，供下一次指纹异常判定使用。指纹为空时不记录，
// 避免「前端尚未发送指纹」被误判成指纹频繁变化。
function noteFingerprint(userId, fingerprint) {
  if (!userId || !fingerprint) return;
  try {
    var store = fingerprintStore();
    var now = Date.now();
    if (countKeys(store) > FINGERPRINT_TRACE_MAX_ENTRIES) pruneFingerprintTraces(store, now);
    var trace = store[userId];
    if (!trace) {
      trace = { windowStart: now, distinct: {}, updatedAt: now };
    }
    trace.pendingFingerprint = String(fingerprint);
    trace.updatedAt = now;
    store[userId] = trace;
  } catch (_) {}
}

/**
 * 审计留痕。项目现存的审计集合是 `audit_logs`
 * （pb_migrations/20260629001000_create_audit_logs.pb.js，字段
 *  actor/action/target_collection/target_id/summary），不是 security_audit_log。
 * 只记录用户 id 与目标 id，绝不落原始 IP / User-Agent / 指纹明文。
 * 尽力而为：任何失败只写一行 stderr，绝不影响主流程。
 */
function auditAction(action, detail) {
  var info = detail || {};
  try {
    var dao = $app.dao();
    var collection = dao.findCollectionByNameOrId('audit_logs');
    if (!collection) return false;
    var record = new Record(collection);
    record.set('actor', String(info.actor || 'anonymous').slice(0, 255));
    record.set('action', String(action).slice(0, 100));
    record.set('target_collection', String(info.targetCollection || '').slice(0, 100));
    record.set('target_id', String(info.targetId || '').slice(0, 100));
    record.set('summary', String(info.summary || '').slice(0, 500));
    dao.saveRecord(record);
    return true;
  } catch (_) {
    try {
      console.error('[action-audit] operation=' + String(action) + ' result=INTERNAL_ERROR');
    } catch (_e) {}
    return false;
  }
}

module.exports = {
  USER_POLICY_KEYS: USER_POLICY_KEYS,
  FINGERPRINT_ANOMALY_WINDOW_MS: FINGERPRINT_ANOMALY_WINDOW_MS,
  FINGERPRINT_ANOMALY_DISTINCT: FINGERPRINT_ANOMALY_DISTINCT,
  resolveAuth: resolveAuth,
  currentUser: currentUser,
  requireUser: requireUser,
  clientIp: clientIp,
  header: header,
  clientFingerprint: clientFingerprint,
  checkRateLimit: checkRateLimit,
  fingerprintAnomalyKey: fingerprintAnomalyKey,
  noteFingerprint: noteFingerprint,
  auditAction: auditAction,
  actionUnavailable: actionUnavailable,
  actionRateLimited: actionRateLimited,
};
