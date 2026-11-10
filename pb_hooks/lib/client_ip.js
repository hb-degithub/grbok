'use strict';

// 真实客户端 IP 统一取值（2026-11-08 渗透测试修复 / Task 3）。
//
// 旧实现无条件优先 ali-real-client-ip：任何能直连源站（绕过 ESA/雷池/Caddy）
// 或自带同名头的攻击者都能自证任意 IP，login_ip / comment_ip 等 per-IP 桶随之
// 可无限轮换（限流形同虚设）。新语义（默认拒绝，可信 peer 白名单）：
//
//   * 仅当 request.remoteAddr 的 TCP host 命中 PB_TRUSTED_PROXY_IPS
//     （逗号分隔的精确 IP 或 CIDR）时，才采信 ali-real-client-ip 头；
//   * 否则一律使用 socket 对端地址（客户端无法伪造）；
//   * 不使用 X-Forwarded-For / X-Real-IP，也不回退 realIP()（同样可被客户端伪造）。
//   * 非法/缺失地址原样返回，交由调用方（如 login_security_lib.normalizeSubjectIp）
//     收敛到统一桶，绝不因解析失败而跳过限流。
//
// 部署前提：生产 PocketBase 只经 Caddy 反代访问，必须在 compose/.env 显式设置
// PB_TRUSTED_PROXY_IPS 为 Caddy 所在容器网的 CIDR（例如 172.18.0.0/16），
// 并由 Caddyfile 的 header_up Ali-Real-Client-Ip {client_ip} 写入该头。
// 未设置时 PB 只看到 Caddy 的容器 IP —— 安全但所有客户端共享一个 per-IP 桶。
//
// 解析实现要求（不得退化为字符串前缀匹配）：
//   - 条目支持精确 IPv4/IPv6 与 CIDR（v4 前缀 0..32，v6 前缀 0..128）；
//   - IPv4-mapped IPv6（::ffff:a.b.c.d）归一到 IPv4 后比较，兼容双栈反代；
//   - 非法条目忽略（fail-closed：配置写错只会不信任，不会信任任意来源）。

function parseIpv4(value) {
  var text = String(value || '').trim();
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(text)) return null;
  var parts = text.split('.');
  var bytes = [];
  for (var i = 0; i < 4; i++) {
    var part = Number(parts[i]);
    if (!(part >= 0 && part <= 255)) return null;
    bytes.push(part);
  }
  return bytes;
}

// ::ffff:a.b.c.d / ::ffff:0:a.b.c.d 之外的 IPv6 尾部 IPv4 也支持。
function ipv4TailBytes(token) {
  var v4 = parseIpv4(token);
  return v4 || null;
}

function parseIpv6(value) {
  var text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  if (text.charAt(0) === '[' && text.charAt(text.length - 1) === ']') text = text.slice(1, -1);
  if (text.indexOf('%') !== -1) return null;

  // IPv4-mapped（::ffff:a.b.c.d）：直接按 IPv4 比较。
  if (text.indexOf('::ffff:') === 0) {
    var mapped = parseIpv4(text.slice(7));
    if (!mapped) return null;
    return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff].concat(mapped);
  }

  var doubleColon = text.indexOf('::');
  var leftParts;
  var rightParts;
  var zerosNeeded = 0;
  if (doubleColon !== -1) {
    if (text.indexOf('::', doubleColon + 1) !== -1) return null;
    var left = text.slice(0, doubleColon);
    var right = text.slice(doubleColon + 2);
    leftParts = left ? left.split(':') : [];
    rightParts = right ? right.split(':') : [];
  } else {
    leftParts = text.split(':');
    rightParts = [];
  }

  var v4Tail = null;
  var lastToken = rightParts.length ? rightParts[rightParts.length - 1] : (leftParts.length ? leftParts[leftParts.length - 1] : '');
  if (lastToken && lastToken.indexOf('.') !== -1) {
    v4Tail = ipv4TailBytes(lastToken);
    if (!v4Tail) return null;
    if (rightParts.length) rightParts = rightParts.slice(0, rightParts.length - 1);
    else leftParts = leftParts.slice(0, leftParts.length - 1);
  }

  var expected = v4Tail ? 7 : 8;
  if (doubleColon !== -1) {
    var total = leftParts.length + rightParts.length;
    if (total >= expected) return null;
    zerosNeeded = expected - total;
  } else if (leftParts.length !== expected) {
    return null;
  }

  var parts = leftParts;
  for (var z = 0; z < zerosNeeded; z++) parts.push('0');
  for (var r = 0; r < rightParts.length; r++) parts.push(rightParts[r]);

  if ((v4Tail ? 6 : 8) !== parts.length) return null;
  var bytes = [];
  for (var i = 0; i < parts.length; i++) {
    if (!/^[0-9a-f]{1,4}$/.test(parts[i])) return null;
    var group = Number.parseInt(parts[i], 16);
    bytes.push((group >> 8) & 0xff, group & 0xff);
  }
  if (v4Tail) bytes = bytes.concat(v4Tail);
  return bytes.length === 16 ? bytes : null;
}

function ipv4FromMapped(bytes) {
  if (!bytes || bytes.length !== 16) return null;
  for (var i = 0; i < 10; i++) if (bytes[i] !== 0) return null;
  if (bytes[10] !== 0xff || bytes[11] !== 0xff) return null;
  return bytes.slice(12);
}

function parseIpBytes(value) {
  var v4 = parseIpv4(value);
  if (v4) return v4;
  var v6 = parseIpv6(value);
  if (!v6) return null;
  var mapped = ipv4FromMapped(v6);
  return mapped || v6;
}

// "1.2.3.4:5678" / "[::1]:5678" / 裸 IPv6 → host 部分。
function remoteHost(remoteAddr) {
  var text = String(remoteAddr || '').trim();
  if (!text) return '';
  if (text.charAt(0) === '[') {
    var end = text.indexOf(']');
    if (end !== -1) return text.slice(1, end);
  }
  var colons = text.split(':').length - 1;
  if (colons === 1) return text.slice(0, text.lastIndexOf(':'));
  return text;
}

function parseCidrEntry(entry) {
  var text = String(entry || '').trim();
  if (!text) return null;
  var addrText = text;
  var prefix = -1;
  var slash = text.lastIndexOf('/');
  if (slash !== -1) {
    addrText = text.slice(0, slash).trim();
    var prefixText = text.slice(slash + 1).trim();
    if (!/^\d{1,3}$/.test(prefixText)) return null;
    prefix = Number(prefixText);
  }
  var bytes = parseIpv4(addrText);
  if (bytes) {
    if (prefix === -1) prefix = 32;
    if (!(prefix >= 0 && prefix <= 32)) return null;
    return { bytes: bytes, prefix: prefix };
  }
  bytes = parseIpv6(addrText);
  if (!bytes) return null;
  var mapped = ipv4FromMapped(bytes);
  if (mapped) {
    if (prefix === -1) prefix = 32;
    if (!(prefix >= 0 && prefix <= 32)) return null;
    return { bytes: mapped, prefix: prefix };
  }
  if (prefix === -1) prefix = 128;
  if (!(prefix >= 0 && prefix <= 128)) return null;
  return { bytes: bytes, prefix: prefix };
}

function bytesMatch(hostBytes, entry) {
  if (!hostBytes || !entry || hostBytes.length !== entry.bytes.length) return false;
  var fullBytes = Math.floor(entry.prefix / 8);
  var remainingBits = entry.prefix % 8;
  for (var i = 0; i < fullBytes; i++) {
    if (hostBytes[i] !== entry.bytes[i]) return false;
  }
  if (remainingBits) {
    var mask = (0xff << (8 - remainingBits)) & 0xff;
    if ((hostBytes[fullBytes] & mask) !== (entry.bytes[fullBytes] & mask)) return false;
  }
  return true;
}

// PB_TRUSTED_PROXY_IPS 解析结果按原始字符串缓存（进程内一次解析）。
function trustedProxyEntries() {
  var raw = '';
  try {
    raw = typeof $os !== 'undefined' && $os ? String($os.getenv('PB_TRUSTED_PROXY_IPS') || '') : '';
  } catch (_) {
    raw = '';
  }
  var cache = globalThis.__pbTrustedProxyCache;
  if (cache && cache.raw === raw) return cache.entries;
  var entries = [];
  var parts = raw.split(',');
  for (var i = 0; i < parts.length; i++) {
    var parsed = parseCidrEntry(parts[i]);
    if (parsed) entries.push(parsed);
  }
  globalThis.__pbTrustedProxyCache = { raw: raw, entries: entries };
  return entries;
}

function isTrustedProxyHost(host) {
  var bytes = parseIpBytes(host);
  if (!bytes) return false;
  var entries = trustedProxyEntries();
  for (var i = 0; i < entries.length; i++) {
    if (bytesMatch(bytes, entries[i])) return true;
  }
  return false;
}

function headerValue(header) {
  var text = String(header || '').trim();
  var comma = text.indexOf(',');
  if (comma !== -1) text = text.slice(0, comma).trim();
  return text;
}

// 兼容调用方传入 core.RequestEvent（含 httpContext）或 http.Context。
function clientIp(c) {
  try {
    var h = c && c.httpContext ? c.httpContext : c;
    var req = h.request();
    var peer = remoteHost(req.remoteAddr);
    if (peer && isTrustedProxyHost(peer)) {
      var forwarded = headerValue(req.header.get('ali-real-client-ip'));
      if (forwarded) return forwarded;
    }
    return String(peer || '').trim();
  } catch (_) {
    return '';
  }
}

module.exports = {
  clientIp: clientIp,
  // 仅测试/诊断用的内部解析器（不参与生产取值）。
  _remoteHost: remoteHost,
  _parseIpBytes: parseIpBytes,
  _parseCidrEntry: parseCidrEntry,
  _bytesMatch: bytesMatch,
};
