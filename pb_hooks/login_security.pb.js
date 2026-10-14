// 密码登录速率限制（per-IP + per-email）— 薄注册层。
// PB 0.22 JSVM 的 onAdmin* 回调按源码字符串在请求级 runtime 重 eval，
// 访问不到文件级闭包（此前 checkAndRecord ReferenceError 导致管理员密码登录恒 400）。
// 全部逻辑在 pb_hooks/lib/login_security_lib.js，回调内 require（与 stats_track.pb.js 一致）。
//
// 2026-10-14（#5）：计数已下沉到 security_rate_buckets 持久化策略表，
// "失败计数"改由 onBefore 回调内的 consume 一步完成（校验口令之前计数），
// 因此不再需要 onAfter 里的 recordLoginFailure；onAfter 只保留"成功即清零"。
onRecordBeforeAuthWithPasswordRequest((e) => {
  require(__hooks + '/lib/login_security_lib.js').checkAndRecord(e);
}, 'users');

onRecordAfterAuthWithPasswordRequest((e) => {
  // 只有登录成功才清零（失败尝试已在 onBefore 内计数落库）
  if (e.authRecord) {
    require(__hooks + '/lib/login_security_lib.js').clearAttempts(e);
  }
}, 'users');

onAdminBeforeAuthWithPasswordRequest((e) => {
  require(__hooks + '/lib/login_security_lib.js').checkAndRecord(e);
});

onAdminAfterAuthWithPasswordRequest((e) => {
  if (e.authRecord) {
    require(__hooks + '/lib/login_security_lib.js').clearAttempts(e);
  }
});
