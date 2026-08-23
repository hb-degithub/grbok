'use strict';

// /api/blog-admin/security/* 路由共享 helper。
// PB 0.22 JSVM 的 routerAdd 回调按源码字符串在请求级 runtime 重 eval，
// 访问不到 .pb.js 文件级闭包，因此这些 helper 必须在 lib 中经 require 调用。
// 注意：lib 模块作用域内 __hooks 不存在（实测顶层与函数体内均抛
// Invalid module），require 一律用相对路径。

// step-up 门禁 + 审计依赖，返回带 writeAudit/nowMs 的 security 上下文
function dependencies(c, actionCode) {
  var stepUp = require('./admin_step_up.js');
  var audit = require('./admin_security_audit.js');
  var security = stepUp.requireAdminStepUp(c, { requireVerifiedEmail: true, requireSuperAdmin: true, requireTrustedAdminIp: true, actionCode: actionCode });
  security.writeAudit = audit.writeSecurityAudit;
  security.nowMs = Date.now();
  return security;
}

function body(c) {
  return JSON.parse(readerToString(c.request().body, 131072) || '{}');
}

// 业务错误码 -> HTTP 状态映射；未知错误继续抛出由 PB 默认处理
function failure(c, error) {
  var code = String(error && error.code || 'INTERNAL_ERROR');
  if (code === 'POLICY_OUT_OF_SAFE_RANGE' || code === 'INVALID_REGISTRATION_MODE') return c.json(422, { code: code });
  if (code === 'POLICY_VERSION_CONFLICT' || code === 'REGISTRATION_MODE_VERSION_CONFLICT') return c.json(409, { code: code });
  if (code === 'ADMIN_OPERATION_RATE_LIMITED') return c.json(429, { code: code, retryAfter: Number(error.retryAfter || 1) });
  throw error;
}

module.exports = {
  dependencies: dependencies,
  body: body,
  failure: failure,
};
