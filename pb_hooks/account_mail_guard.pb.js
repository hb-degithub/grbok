(function () {
  /// <reference path="../pb_data/types.d.ts" />

  // 2026-10-14 渗透测试 #4（邮箱存在性枚举）+ 2026-11-08 渗透测试修复（Task 3）。
  //
  // 一、request-email-change 枚举 oracle（2026-10-14 起已修）
  //   事实：PB 0.22 原生 POST /api/collections/users/request-email-change 在
  //   「新邮箱已被占用」时返回 400，未占用时返回 204（成功路径即 204，见
  //   apis/record_auth.go → NoContent(204)），构成邮箱枚举 oracle。
  //   手法：onBeforeApiError 把该端点的 4xx 改写成与成功路径完全一致的 204 空响应。
  //
  // 二、confirm-email-change 枚举 oracle（2026-11-08 修复，真实 PB 0.22.48 实测）
  //   原生 POST /api/collections/users/confirm-email-change 会先解析 token payload
  //   （**未验签**）读取 newEmail，再做「newEmail 是否已注册」检查，最后才验签：
  //     - newEmail 已注册：400，data.token.code=validation_existing_token_email，
  //       message="The new email address is already registered: <邮箱原文>."
  //     - newEmail 未注册：400，data.token.code=validation_invalid_token
  //   攻击者无需密钥：截取任一真实 token 的 payload（或自造可解析 payload），
  //   替换签名即可把该端点变成"批量核对邮箱是否注册"的 oracle，且回显邮箱原文。
  //   修法：对 confirm-email-change 的**全部 4xx** 统一改写为同一个不含邮箱的
  //   400 响应（不能伪装成 2xx —— 确认失败绝不能报告成功）。
  //
  // 三、环回豁免（仅 request-email-change 需要）
  //   站内门面 /api/blog-auth/email-change/request 在服务端通过 $http.send 回调
  //   环回地址（lib/auth_facade.js: forwardToLoopback → 127.0.0.1），该调用必须
  //   继续走真实 PB 流程并拿到真实 4xx（真正发出改邮箱邮件）。
  //   判定用 request().remoteAddr（TCP 源地址，客户端无法伪造），**不用**
  //   client_ip.js 的头派生值。
  //   confirm-email-change 没有站内门面（前端直接调 PB），因此不做环回豁免。
  //
  // 语义依据（core/apis/base.go:94-105）：hook 里一旦写出响应，Response().Committed
  // 为真，默认的 JSON(code, apiErr) 处理会被跳过，因此自定义响应不会被覆盖。
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

      var REQUEST_ROUTES = ['/api/collections/:collection/request-email-change'];
      var REQUEST_LITERALS = [
        '/api/collections/users/request-email-change',
        '/api/collections/_pb_users_auth_/request-email-change',
      ];
      var CONFIRM_ROUTES = ['/api/collections/:collection/confirm-email-change'];
      var CONFIRM_LITERALS = [
        '/api/collections/users/confirm-email-change',
        '/api/collections/_pb_users_auth_/confirm-email-change',
      ];

      var routePath = '';
      try { routePath = String(e.httpContext.path() || ''); } catch (_) { routePath = ''; }

      var rawPath = '';
      try { rawPath = String(e.httpContext.request().url.path || ''); } catch (_) { rawPath = ''; }

      var isRequest = REQUEST_ROUTES.indexOf(routePath) !== -1
        || REQUEST_LITERALS.indexOf(rawPath) !== -1;
      var isConfirm = CONFIRM_ROUTES.indexOf(routePath) !== -1
        || CONFIRM_LITERALS.indexOf(rawPath) !== -1;
      if (!isRequest && !isConfirm) return;

      // PB 0.22 的 ApiError 只在 e.error.code 上暴露 HTTP 状态码。
      var status = Number(e.error.code || e.error.statusCode || e.error.status || 0);
      if (!(status >= 400 && status < 500)) return;

      if (isConfirm) {
        // 统一、无邮箱原文的 4xx：token 无效 / 已注册 / 口令错误三种情况逐字节一致。
        // 不伪装成功（不返回 2xx），否则会出现"确认失败却提示已变更"。
        e.httpContext.json(400, {
          code: 400,
          message: '邮箱确认失败，请重新发起邮箱变更',
          data: {},
        });
        return;
      }

      // request-email-change：
      // 401 不改写：它对所有匿名请求一致（不存在性无关），且改写会掩盖鉴权语义。
      if (status === 401) return;

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
