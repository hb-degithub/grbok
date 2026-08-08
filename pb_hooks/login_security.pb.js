// 密码登录速率限制（per-IP + per-email）— 薄注册层。
// PB 0.22 JSVM 的 onAdmin* 回调按源码字符串在请求级 runtime 重 eval，
// 访问不到文件级闭包（此前 checkAndRecord ReferenceError 导致管理员密码登录恒 400）。
// 全部逻辑在 pb_hooks/lib/login_security_lib.js，回调内 require（与 stats_track.pb.js 一致）。

onRecordBeforeAuthWithPasswordRequest((e) => {
  require(__hooks + '/lib/login_security_lib.js').checkAndRecord(e);
}, 'users');

onRecordAfterAuthWithPasswordRequest((e) => {
  // 登录成功时清除失败计数
  require(__hooks + '/lib/login_security_lib.js').clearAttempts(e);
}, 'users');

// 登录失败时记录失败计数（onRecordAuthWithPasswordError 在认证失败时触发）
onRecordAuthWithPasswordError((e) => {
  require(__hooks + '/lib/login_security_lib.js').recordLoginFailure(e);
}, 'users');

onAdminBeforeAuthWithPasswordRequest((e) => {
  require(__hooks + '/lib/login_security_lib.js').checkAndRecord(e);
});

onAdminAfterAuthWithPasswordRequest((e) => {
  require(__hooks + '/lib/login_security_lib.js').clearAttempts(e);
});

// 管理员登录失败时记录失败计数
onAdminAuthWithPasswordError((e) => {
  require(__hooks + '/lib/login_security_lib.js').recordLoginFailure(e);
});
