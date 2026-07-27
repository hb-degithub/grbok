'use strict';

// ============================================================================
// TOTP (RFC 6238) 核心库 — PocketBase JSVM (goja) 兼容，零外部依赖
//
// 算法选择：HMAC-SHA256（otpauth URI 声明 algorithm=SHA256）。
// Google Authenticator / Microsoft Authenticator / 1Password / Authy 均支持。
// JSVM 无 Buffer/Node crypto，字节操作用普通数组 + 位运算。
// ============================================================================

var TOTP_TIME_STEP = 30;      // 秒
var TOTP_DIGITS = 6;
var TOTP_WINDOW = 1;          // 容忍前后各 1 个时间步（±30s 时钟漂移）
var SECRET_BYTES = 20;        // 160-bit 密钥

// ---------- Base32 (RFC 4648) ----------
var B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(bytes) {
  var out = '';
  var bits = 0;
  var value = 0;
  for (var i = 0; i < bytes.length; i++) {
    value = (value << 8) | (bytes[i] & 0xff);
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += B32_ALPHABET.charAt((value << (5 - bits)) & 31);
  }
  // 填充到 8 的倍数
  while (out.length % 8 !== 0) {
    out += '=';
  }
  return out;
}

function base32Decode(str) {
  var clean = String(str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  var bytes = [];
  var bits = 0;
  var value = 0;
  for (var i = 0; i < clean.length; i++) {
    var idx = B32_ALPHABET.indexOf(clean.charAt(i));
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return bytes;
}

// ---------- 字节工具 ----------
function hexToBytes(hex) {
  var bytes = [];
  var text = String(hex || '').replace(/\s/g, '');
  for (var i = 0; i + 1 < text.length; i += 2) {
    bytes.push(parseInt(text.substr(i, 2), 16));
  }
  return bytes;
}

function bytesToHex(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var h = (bytes[i] & 0xff).toString(16);
    out += (h.length < 2 ? '0' : '') + h;
  }
  return out;
}

function stringToBytes(str) {
  var bytes = [];
  var text = String(str);
  for (var i = 0; i < text.length; i++) {
    bytes.push(text.charCodeAt(i) & 0xff);
  }
  return bytes;
}

// 8 字节大端计数器
function counterToBytes(counter) {
  var bytes = [0, 0, 0, 0, 0, 0, 0, 0];
  var value = counter;
  for (var i = 7; i >= 0; i--) {
    bytes[i] = value & 0xff;
    value = Math.floor(value / 256);
  }
  return bytes;
}

// ---------- 纯 JS SHA-256 / HMAC（字节数组实现）----------
// 不能用 $security.hs256 处理二进制数据：goja 字符串转字节按 UTF-8 编码，
// 码点 ≥ 0x80 的字符会变成多字节，导致 HMAC 输入与 RFC 6238 不符（生产已踩坑）。
// $security.hs256 仅在输入保证为纯 ASCII 时可用（如 encryptSecret 的 hex 串）。

var SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function rotr32(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }

function sha256Bytes(message) {
  var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  var bitLen = message.length * 8;
  var bytes = message.slice();
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  // 8 字节大端消息长度（本场景消息很短，高位为 0）
  for (var i = 7; i >= 0; i--) {
    bytes.push(Math.floor(bitLen / Math.pow(2, i * 8)) & 0xff);
  }
  var w = new Array(64);
  for (var block = 0; block < bytes.length; block += 64) {
    var t;
    for (t = 0; t < 16; t++) {
      var j = block + t * 4;
      w[t] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0;
    }
    for (t = 16; t < 64; t++) {
      var s0 = (rotr32(w[t - 15], 7) ^ rotr32(w[t - 15], 18) ^ (w[t - 15] >>> 3)) >>> 0;
      var s1 = (rotr32(w[t - 2], 17) ^ rotr32(w[t - 2], 19) ^ (w[t - 2] >>> 10)) >>> 0;
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    var a = h[0], b = h[1], cc = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (t = 0; t < 64; t++) {
      var S1 = (rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25)) >>> 0;
      var ch = ((e & f) ^ (~e & g)) >>> 0;
      var t1 = (hh + S1 + ch + SHA256_K[t] + w[t]) >>> 0;
      var S0 = (rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22)) >>> 0;
      var maj = ((a & b) ^ (a & cc) ^ (b & cc)) >>> 0;
      var t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = cc; cc = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + cc) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  var out = [];
  for (i = 0; i < 8; i++) {
    out.push((h[i] >>> 24) & 0xff, (h[i] >>> 16) & 0xff, (h[i] >>> 8) & 0xff, h[i] & 0xff);
  }
  return out;
}

function hmacSha256Bytes(keyBytes, messageBytes) {
  var key = keyBytes.slice();
  if (key.length > 64) key = sha256Bytes(key);
  while (key.length < 64) key.push(0);
  var inner = [];
  var outer = [];
  for (var i = 0; i < 64; i++) {
    inner.push(key[i] ^ 0x36);
    outer.push(key[i] ^ 0x5c);
  }
  return sha256Bytes(outer.concat(sha256Bytes(inner.concat(messageBytes))));
}

// ---------- TOTP 核心 ----------

function currentTimestep(atMs) {
  var ms = typeof atMs === 'number' ? atMs : Date.now();
  return Math.floor(ms / 1000 / TOTP_TIME_STEP);
}

// 生成 6 位动态码（HMAC-SHA256 版本，RFC 6238 标准实现）
function totpAt(secretBytes, timestep) {
  var digest = hmacSha256Bytes(secretBytes, counterToBytes(timestep));
  var offset = digest[digest.length - 1] & 0x0f;
  var binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  var code = binary % 1000000;
  var text = String(code);
  while (text.length < TOTP_DIGITS) text = '0' + text;
  return text;
}

// 生成新密钥，返回 { base32, hex }
function generateSecret() {
  var raw = $security.randomStringWithAlphabet(SECRET_BYTES, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
  var bytes = stringToBytes(raw);
  return {
    base32: base32Encode(bytes),
    hex: bytesToHex(bytes),
  };
}

function secretFromHex(hex) {
  return hexToBytes(hex);
}

// 校验动态码：时间窗 ±TOTP_WINDOW，防重放水线
// 返回 { ok: bool, timestep: number, replay: bool }
// timestep 为命中的时间步（-1 表示失败）；replay=true 表示码正确但已被使用过
function verifyCode(secretBytes, code, lastUsedTimestep, atMs) {
  var normalized = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(normalized)) return { ok: false, timestep: -1, replay: false };
  var now = currentTimestep(atMs);
  var lastUsed = typeof lastUsedTimestep === 'number' && isFinite(lastUsedTimestep) ? lastUsedTimestep : -1;
  var replay = false;
  for (var drift = -TOTP_WINDOW; drift <= TOTP_WINDOW; drift++) {
    var step = now + drift;
    var matched = $security.equal(totpAt(secretBytes, step), normalized);
    if (step <= lastUsed) {
      if (matched) replay = true; // 防重放：码本身正确，但该时间步已被消费
      continue;
    }
    if (matched) {
      return { ok: true, timestep: step, replay: false };
    }
  }
  return { ok: false, timestep: -1, replay: replay };
}

// otpauth:// URI（用于二维码）
function buildOtpauthUri(base32Secret, accountName, issuer) {
  var enc = encodeURIComponent;
  var label = enc(issuer) + ':' + enc(accountName);
  return 'otpauth://totp/' + label +
    '?secret=' + base32Secret +
    '&issuer=' + enc(issuer) +
    '&algorithm=SHA256&digits=' + TOTP_DIGITS + '&period=' + TOTP_TIME_STEP;
}

// ---------- secret 加密存储（HMAC 密钥派生 + XOR 流 + 完整性校验）----------
// JSVM 无 AES，采用 PB_ENCRYPTION_KEY 派生密钥流加密 + HMAC 完整性标签。
// 格式: v1.<nonce_hex>.<cipher_hex>.<tag_hex>

function encryptionKey() {
  var key = String($os.getenv('PB_ENCRYPTION_KEY') || '').trim();
  if (key.length < 16) throw new Error('PB_ENCRYPTION_KEY is not configured');
  return key;
}

function encryptSecret(plainHex) {
  var key = encryptionKey();
  var nonce = $security.randomStringWithAlphabet(16, 'abcdef0123456789');
  var plain = String(plainHex);
  var cipher = '';
  for (var i = 0; i < plain.length; i += 64) {
    var blockIndex = Math.floor(i / 64);
    var keyStream = $security.hs256(nonce + ':' + blockIndex, key);
    var chunk = plain.substr(i, 64);
    var out = '';
    for (var j = 0; j < chunk.length; j++) {
      var kc = parseInt(keyStream.substr(j % 64, 1), 16);
      var pc = parseInt(chunk.charAt(j), 16);
      out += (pc ^ kc).toString(16);
    }
    cipher += out;
  }
  var tag = $security.hs256('v1.' + nonce + '.' + cipher, key);
  return 'v1.' + nonce + '.' + cipher + '.' + tag;
}

function decryptSecret(payload) {
  var key = encryptionKey();
  var parts = String(payload || '').split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('TOTP_SECRET_INVALID');
  var nonce = parts[1];
  var cipher = parts[2];
  var tag = parts[3];
  var expectedTag = $security.hs256('v1.' + nonce + '.' + cipher, key);
  if (!$security.equal(expectedTag, tag)) throw new Error('TOTP_SECRET_TAMPERED');
  var plain = '';
  for (var i = 0; i < cipher.length; i += 64) {
    var blockIndex = Math.floor(i / 64);
    var keyStream = $security.hs256(nonce + ':' + blockIndex, key);
    var chunk = cipher.substr(i, 64);
    var out = '';
    for (var j = 0; j < chunk.length; j++) {
      var kc = parseInt(keyStream.substr(j % 64, 1), 16);
      var cc = parseInt(chunk.charAt(j), 16);
      out += (cc ^ kc).toString(16);
    }
    plain += out;
  }
  return plain;
}

module.exports = {
  TIME_STEP: TOTP_TIME_STEP,
  DIGITS: TOTP_DIGITS,
  generateSecret: generateSecret,
  secretFromHex: secretFromHex,
  totpAt: totpAt,
  verifyCode: verifyCode,
  buildOtpauthUri: buildOtpauthUri,
  encryptSecret: encryptSecret,
  decryptSecret: decryptSecret,
  base32Encode: base32Encode,
  base32Decode: base32Decode,
};
