(function () {
  /// <reference path="../pb_data/types.d.ts" />

  // 评论 AI 审核/回复 worker -- 每分钟驱动一次。
  // 注意：cron 回调按源码字符串在请求级 runtime 重新 eval，访问不到本 IIFE 的闭包，
  // 因此这里只做壳：require lib 模块执行，错误就地捕获不抛出。
  // 实际逻辑见 pb_hooks/lib/ai_comment_worker.js（未启用/comment_mode=off 时静默返回）。

  cronAdd('ai-comment-worker', '* * * * *', function () {
    try { require(__hooks + '/lib/ai_comment_worker.js').run(); }
    catch (err) { console.log('[ai-comment-worker] operation=worker result=INTERNAL_ERROR detail=' + String(err && err.message || err).slice(0, 200)); }
  });
})();
