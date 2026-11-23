/// <reference path="../pb_data/types.d.ts" />

// ALTCHA v1 人机校验的 challenge 签发端点（2026-11-23）。
//
//   GET /api/captcha/challenge
//     → 200 { algorithm, challenge, maxnumber, salt, signature }
//     → 429 { code: 'CAPTCHA_RATE_LIMITED', retryAfter }   per-IP 限流命中
//     → 503 { code: 'CAPTCHA_UNCONFIGURED' }             未设置 ALTCHA_HMAC_KEY
//     → 503 { code: 'CAPTCHA_UNAVAILABLE' }              限流策略表不可用（fail-closed）
//   响应头 Cache-Control: no-store（challenge 一次性，绝不可缓存）。
//
// PB 0.22 JSVM 的 routerAdd 回调按源码字符串在请求级 runtime 重新 eval，
// 访问不到本文件的闭包变量，因此 handler 必须在回调内 require（与
// blog_auth.pb.js / comment_actions.pb.js 一致）。全部逻辑在 lib/altcha.js。
(function () {
  routerAdd('GET', '/api/captcha/challenge', function (c) {
    return require(__hooks + '/lib/altcha.js').challengeHandler(c, {
      // 与 altcha-lib / altcha.js DEFAULT_MAXNUMBER 对齐：客户端最多暴力 100 万次。
      maxnumber: 1000000,
      // challenge 有效期 600s，与 auth_otp.js 的 EXPIRES_SECONDS 同量级。
      ttlSeconds: 600,
    });
  });
})();
