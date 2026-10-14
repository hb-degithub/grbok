(function () {
  /// <reference path="../pb_data/types.d.ts" />

  // 2026-10-14 渗透测试 #10（users 可自改特权字段）修复。
  //
  // 背景：users 的 updateRule 是**记录级**（`id = @request.auth.id || @request.auth.role = "super_admin"`，
  // 见 pb_migrations/20260629008000_extend_posts_tags.pb.js:35），PB 没有字段级规则，
  // 因此任何登录用户都能通过 PATCH /api/collections/users/records/<自己的 id> 改写自己记录上的
  // 任意字段。既有 guard_user_role.pb.js 只钉住了 `role`。
  //
  // 真实影响：`level`/`experience` 被伪造成 ≥3 即可绕过评论先审
  //（pb_hooks/validate_comment.pb.js:238,247-248 以作者 level 决定是否 pending）；
  // `vip_expire_at`、`emailVisibility`、`username`、`stats`/`level_config`/`level_history`
  // 同样不应由用户自定。
  //
  // 策略（fail closed）：
  //   - 请求者是 admin/super_admin → 完全放行（后台管理用户）。
  //   - 其它请求者：受保护字段**无条件回写库中原值**（不做值比较，避免 Go 值与 JS 值
  //     比较失配导致漏放行）；`verified` 采用单向钳制（禁止 false → true，允许由
  //     PB core 在改邮箱时置 false）。
  //   - `role` 不在此列表：由 guard_user_role.pb.js 以显式 400 处理，避免改变其报错语义。
  //   - `email` 一并钉死：邮箱变更必须走 PB 的 request-email-change 确认流；
  //     confirm-email-change 由 core 直接 saveRecord，不经过本 API 请求钩子。
  //   - 允许自改：name / bio / avatar / password（core 强制 oldPassword）/ notify_* 通知偏好
  //     （前端唯一用途见 astro/src/lib/services/userService.ts:88）。
  //
  // PB 0.22 JSVM 注意：handler 在独立作用域执行，看不到本文件 IIFE 内的常量/函数，
  // 因此本 handler 自包含（同 account_mail_guard.pb.js 的实测结论）。

  onRecordBeforeUpdateRequest(function (e) {
    var FORCED_FIELDS = [
      'email',
      'level',
      'experience',
      'vip_expire_at',
      'emailVisibility',
      'stats',
      'level_config',
      'level_history',
    ];

    if (!e || !e.record) return;

    var roleOf = function (record) {
      if (!record || typeof record.get !== 'function') return '';
      return String(record.get('role') || '').trim();
    };

    var auth = null;
    if (e.auth) {
      auth = e.auth;
    } else {
      try {
        if (typeof $apis !== 'undefined' && e.httpContext) {
          var info = $apis.requestInfo(e.httpContext);
          auth = info.auth || info.authRecord || null;
        }
      } catch (_) {}
      if (!auth) {
        try {
          auth = e.httpContext.get('authRecord') || e.httpContext.get('auth') || null;
        } catch (_) {}
      }
    }

    var authRole = roleOf(auth);
    if (authRole === 'admin' || authRole === 'super_admin') {
      if (typeof e.next === 'function') e.next();
      return;
    }

    // 库中原值：DAO 每次查询返回新的 Record 实例，因此这里是更新前的值
    //（既有 guard_user_role.pb.js 用同一手法读取旧 role）。
    var stored = null;
    try {
      stored = $app.dao().findRecordById('users', e.record.id);
    } catch (_) {
      stored = null;
    }
    if (!stored) {
      // 读不到原值即拒绝，避免用户借机写入特权字段。
      throw new BadRequestError('无法校验用户资料更新，请稍后重试');
    }

    var changed = [];
    for (var i = 0; i < FORCED_FIELDS.length; i++) {
      var field = FORCED_FIELDS[i];
      var oldValue = stored.get(field);
      try {
        if (String(e.record.get(field)) !== String(oldValue)) changed.push(field);
      } catch (_) {
        changed.push(field);
      }
      e.record.set(field, oldValue);
    }

    // username：仅在库中已有非空值时钉死（兼容历史空 username 记录，
    // 否则 PB core 会因 "unable to save auth record without username" 直接拒绝保存）。
    var storedUsername = String(stored.get('username') || '');
    if (storedUsername !== '') {
      if (String(e.record.get('username') || '') !== storedUsername) {
        changed.push('username');
        e.record.set('username', storedUsername);
      }
    }

    // verified：单向钳制，禁止自助"验证通过"。
    if (stored.get('verified') !== true && e.record.get('verified') === true) {
      changed.push('verified');
      e.record.set('verified', false);
    }

    if (changed.length) {
      try {
        $app.logger().warn(
          '[guard-user-fields] restored protected fields on self-service update',
          'userId', String(e.record.id || ''),
          'actorRole', authRole || 'anonymous',
          'fields', changed.join(',')
        );
      } catch (_) {}
    }

    if (typeof e.next === 'function') e.next();
  }, 'users');
})();
