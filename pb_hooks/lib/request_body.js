'use strict';

// 请求体读取统一入口（2026-11-08 渗透测试修复 / Task 4）
//
// 背景：PB 0.22 JSVM 里 $apis.requestInfo(context) 已经完成 body 解析，
// 解析结果在 `info.data`（不是 `.body`）。此前 comment_actions_lib 用
// readerToString(e.request().body) 自己再读一次 request body，导致：
//   1. 与路由上的 $apis.bodyLimit(...) 中间件重复消费 limitedReader；
//   2. 自定义路由的 bodyLimit 和“再读一次”叠加，配合关系守卫的双 next
//      放大成 Go fatal（echo limitedReader 自引用 → stack overflow）。
//
// 现在统一：优先使用 requestInfo().data；兼容 record 事件（context.httpContext）
// 与 routerAdd 事件（context 本身即 echo.Context）两种形态。
// 返回普通对象；非法/缺失/数组 body 一律返回 {}。
//
// 上限说明：requestInfo 的 JSON 内部上限大于路由 bodyLimit(4096)，
// 但路由中间件仍然是实际上限，本模块不再额外放宽。

function resolveContext(context) {
  if (!context) return null;
  // record 事件：e.httpContext 是 echo.Context
  if (context.httpContext) return context.httpContext;
  // routerAdd 事件：e 本身就是 echo.Context
  return context;
}

function readRequestBody(context) {
  var ctx = resolveContext(context);
  if (!ctx) return {};

  var data = null;
  try {
    if (typeof $apis === 'undefined' || !$apis) return {};
    var info = $apis.requestInfo(ctx);
    if (info) data = info.data;
  } catch (_) {
    // 非法 JSON / 读取失败：按空 body 处理（调用方负责给出明确 4xx）
    return {};
  }

  if (!data || typeof data !== 'object') return {};
  if (Array.isArray(data)) return {};
  return data;
}

module.exports = {
  readRequestBody: readRequestBody,
};
