'use strict';

// /api/blog-admin/esa/* 路由共享 helper。
// PB 0.22 JSVM 的 routerAdd 回调按源码字符串在请求级 runtime 重 eval，
// 访问不到 .pb.js 文件级闭包，因此 failure 必须在 lib 中经 require 调用。

// 业务错误码 -> HTTP 状态映射；未知错误继续抛出由 PB 默认处理
function failure(c, error) {
  var code = String(error && error.code || 'INTERNAL_ERROR');
  if (code === 'INVALID_PURGE_URL' || code === 'ESA_CONFIG_INVALID') return c.json(400, { code: code });
  if (code === 'ESA_PURGE_RATE_LIMITED') return c.json(429, { code: code, retryAfter: Number(error.retryAfter || 1) });
  if (code === 'ESA_PAYLOAD_INVALID' || code === 'ESA_INVALID_URL') return c.json(400, { code: code });
  if (code === 'ESA_RATE_LIMITED') return c.json(429, { code: code });
  if (code === 'ESA_NOT_CONFIGURED' || code === 'ESA_QUOTA_EXCEEDED' || code === 'ESA_UPSTREAM_ERROR' || code === 'ESA_UNAVAILABLE') {
    return c.json(Number(error.statusCode) || 503, { code: code });
  }
  throw error;
}

module.exports = {
  failure: failure,
};
