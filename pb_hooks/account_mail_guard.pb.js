(function () {
  /// <reference path="../pb_data/types.d.ts" />

  // 2026-10-14 渗透测试 #4（邮箱存在性枚举）纵深防御。
  //
  // 事实：PB 0.22 原生 POST /api/collections/users/request-email-change 在
  // 「新邮箱已被占用」时返回 400，未占用时返回 204（成功路径即 204，见
  // apis/record_auth.go → NoContent(204)），构成邮箱枚举 oracle。
  // 生产已由 Caddy 404 掉该原生端点（含 %2575sers 双编码绕过，见
  // docs/security-pentest-2026-10-14-triage.md 第三节），本守卫是纵深防御：
  // 即使边缘规则被绕过或回滚，PB 自身也不再通过状态码区分存在性。
  //
  // 手法：onBeforeApiError 把该端点的 4xx 改写成与成功路径完全一致的 204 空响应。
  // 语义依据（core/apis/base.go:94-105）：hook 里一旦写出响应，Response().Committed
  // 为真，默认的 JSON(code, apiErr) 处理会被跳过，因此 204 不会被覆盖。
  //   - 401（未认证）保持原样：任何未认证请求都是 401，不携带存在性信息。
  //   - 环回豁免：站内门面 /api/blog-auth/email-change/request 在服务端通过
  //     $http.send 回调环回地址（lib/auth_facade.js: forwardToLoopback → 127.0.0.1），
  //     该调用必须继续走真实 PB 流程（真正发出改邮箱邮件）。
  //     判定用 request().remoteAddr（TCP 源地址，客户端无法伪造），
  //     **不用** client_ip.js：该实现优先采信边缘写入的 ali-real-client-ip 头，
  //     攻击者自带同名头即可自证"环回"从而跳过本守卫（e2e 已实测）。
  //
  // 2026-10-14 关键修正（Lead 复核实测，原实现完全失效）：
  //   1. PB 0.22 JSVM 里 routerAdd / onBeforeApiError 的 handler 在**独立作用域**
  //      执行，看不到本文件 IIFE 内的常量与函数（实测报
  //      "ReferenceError: EMAIL_CHANGE_PATHS is not defined"），因此本 handler
  //      必须自包含。
  //   2. e.httpContext.path() 返回的是**路由模板**（'/api/collections/:collection/request-email-change'），
  //      不是字面路径，按字面路径匹配永远不会命中。
  //   3. 本实现同时接受路由模板与原始请求路径两种形态。

  onBeforeApiError(function (e) {
    try {
      if (!e || !e.httpContext || !e.error) return;

      var ROUTE_PATTERNS = ['/api/collections/:collection/request-email-change'];
      var LITERAL_PATHS = [
        '/api/collections/users/request-email-change',
        '/api/collections/_pb_users_auth_/request-email-change',
      ];

      var routePath = '';
      try { routePath = String(e.httpContext.path() || ''); } catch (_) { routePath = ''; }

      var rawPath = '';
      try { rawPath = String(e.httpContext.request().url.path || ''); } catch (_) { rawPath = ''; }

      if (ROUTE_PATTERNS.indexOf(routePath) === -1 && LITERAL_PATHS.indexOf(rawPath) === -1) return;

      var status = Number(e.error.statusCode || e.error.status || e.error.code || 0);
      // 401 不改写：它对所有匿名请求一致（不存在性无关），且改写会掩盖鉴权语义。
      if (status === 401 || !(status >= 400) || status >= 500) return;

      // 环回豁免：站内门面转发（TCP 源为 127.0.0.1/::1）。
      var remote = '';
      try { remote = String(e.httpContext.request().remoteAddr || '').trim().toLowerCase(); } catch (_) { remote = ''; }
      var isLoopback = false;
      if (remote === '::1' || remote === '0:0:0:0:0:0:0:1') {
        isLoopback = true;
      } else {
        var normalized = remote.indexOf('::ffff:') === 0 ? remote.slice(7) : remote;
        var hostPart = normalized;
        var lastColon = normalized.lastIndexOf(':');
        if (normalized.indexOf('.') !== -1 && lastColon !== -1) hostPart = normalized.slice(0, lastColon);
        if (hostPart === '127.0.0.1' || hostPart.indexOf('127.') === 0) isLoopback = true;
      }
      if (isLoopback) return;

      // 与成功路径逐字节一致：204 + 空 body。
      e.httpContext.noContent(204);
      return;
    } catch (err) {
      // 失败开放（保留原始 4xx）：宁可少一层纵深防御，也不阻断真实改邮箱流程。
      try { console.error('[account-mail-guard] operation=email-change-enumeration result=INTERNAL_ERROR err=' + String(err)); } catch (_) {}
      return;
    }
  });
})();
