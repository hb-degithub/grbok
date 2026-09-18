(function () {
  /// <reference path="../pb_data/types.d.ts" />

  // 运行状态探针:每分钟对 site_http / pb_self / admin_auth 各采样一次。
  // PB 0.22 JSVM 的 cronAdd 回调按源码字符串在请求级 runtime 重 eval,
  // 访问不到文件级闭包——全部逻辑在 lib/monitor_lib.js,回调内 require。
  cronAdd('monitor-probe', '* * * * *', function () {
    require(__hooks + '/lib/monitor_lib.js').runProbes();
  });

  // 每小时清理 7 天前的样本(错峰到每小时第 23 分钟,避开整点任务)
  cronAdd('monitor-cleanup', '23 * * * *', function () {
    var deleted = require(__hooks + '/lib/monitor_lib.js').cleanupExpired();
    if (deleted > 0) console.log('[monitor] operation=cleanup deleted=' + deleted);
  });
})();
