// 密码登录速率限制（per-IP + per-email）— 薄注册层。
// PB 0.22 JSVM 的 onAdmin* 回调按源码字符串在请求级 runtime 重 eval，
// 访问不到文件级闭包（此前 checkAndRecord ReferenceError 导致管理员密码登录恒 400）。
// 全部逻辑在 pb_hooks/lib/login_security_lib.js，回调内 require（与 stats_track.pb.js 一致）。

onRecordBeforeAuthWithPasswordRequest((e) => {
  require(__hooks + '/lib/login_security_lib.js').checkAndRecord(e);
}, 'users');

onRecordAfterAuthWithPasswordRequest((e) => {
  require(__hooks + '/lib/login_security_lib.js').clearAttempts(e);
}, 'users');

onAdminBeforeAuthWithPasswordRequest((e) => {
  require(__hooks + '/lib/login_security_lib.js').checkAndRecord(e);
});

onAdminAfterAuthWithPasswordRequest((e) => {
  require(__hooks + '/lib/login_security_lib.js').clearAttempts(e);
});
