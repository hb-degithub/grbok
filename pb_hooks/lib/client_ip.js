'use strict';

// 真实客户端 IP 统一取值：
// 优先 ESA 注入的 ali-real-client-ip 标头（边缘节点写入，客户端伪造的同名头会被覆盖）；
// 回退 realIP()（本地开发 / 无 CDN 链路直连场景）。
function clientIp(c) {
  try {
    var h = c && c.httpContext ? c.httpContext : c;
    try {
      var v = String(h.request().header.get('ali-real-client-ip') || '').trim();
      if (v) return v;
    } catch (_) {}
    return String(h.realIP() || '').trim();
  } catch (_) {
    return '';
  }
}

module.exports = { clientIp: clientIp };
