// 密码登录速率限制（per-IP + per-email）— 薄注册层。
// PB 0.22 JSVM 的 onAdmin* 回调按源码字符串在请求级 runtime 重 eval，
// 访问不到文件级闭包（此前 checkAndRecord ReferenceError 导致管理员密码登录恒 400）。
// 全部逻辑在 pb_hooks/lib/login_security_lib.js，回调内 require（与 stats_track.pb.js 一致）。
//
// 2026-10-14（#5）：计数已下沉到 security_rate_buckets 持久化策略表，
// "失败计数"改由 onBefore 回调内的 consume 一步完成（校验口令之前计数），
// 因此不再需要 onAfter 里的 recordLoginFailure；onAfter 只保留"成功即清零"。
//
// 2026-11-08（Task 3）成功事件字段修正（真实 PB 0.22.48 实测）：
//   * users 链路的成功事件把认证记录放在 e.record；admins 链路放在 e.admin；
//     两者都没有旧的 e.authRecord。旧判断 `if (e.authRecord)` 恒假，
//     成功清零整段失效 —— 失败次数会一直累积到窗口结束。
//   清零本身的语义也收窄为"只清该邮箱的两个 email 桶"，共享 per-IP 桶不动
//   （见 login_security_lib.clearAttempts）。
onRecordBeforeAuthWithPasswordRequest((e) => {
  require(__hooks + '/lib/login_security_lib.js').checkAndRecord(e);
}, 'users');

onRecordAfterAuthWithPasswordRequest((e) => {
  // 只有登录成功才清零（失败尝试已在 onBefore 内计数落库）。
  if (e.record || e.authRecord) {
    require(__hooks + '/lib/login_security_lib.js').clearAttempts(e);
  }
}, 'users');

onAdminBeforeAuthWithPasswordRequest((e) => {
  require(__hooks + '/lib/login_security_lib.js').checkAndRecord(e);
});

onAdminAfterAuthWithPasswordRequest((e) => {
  if (e.admin || e.authRecord) {
    require(__hooks + '/lib/login_security_lib.js').clearAttempts(e);
  }
});
