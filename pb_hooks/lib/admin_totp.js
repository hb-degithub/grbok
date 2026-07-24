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
  var text = String(hex || '');
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

function bytesToString(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i] & 0xff);
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

// ---------- TOTP 核心 ----------

function currentTimestep(atMs) {
  var ms = typeof atMs === 'number' ? atMs : Date.now();
  return Math.floor(ms / 1000 / TOTP_TIME_STEP);
}

// 生成 6 位动态码（HMAC-SHA256 版本）
function totpAt(secretBytes, timestep) {
  var counter = bytesToString(counterToBytes(timestep));
  var key = bytesToString(secretBytes);
  var digestHex = $security.hs256(counter, key);
  var digest = hexToBytes(digestHex);
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
// 返回 { ok: bool, timestep: number }（timestep 为命中的时间步，-1 表示失败）
function verifyCode(secretBytes, code, lastUsedTimestep, atMs) {
  var normalized = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(normalized)) return { ok: false, timestep: -1 };
  var now = currentTimestep(atMs);
  var lastUsed = typeof lastUsedTimestep === 'number' && isFinite(lastUsedTimestep) ? lastUsedTimestep : -1;
  for (var drift = -TOTP_WINDOW; drift <= TOTP_WINDOW; drift++) {
    var step = now + drift;
    if (step <= lastUsed) continue; // 防重放：已用过的时间步直接跳过
    var expected = totpAt(secretBytes, step);
    if ($security.equal(expected, normalized)) {
      return { ok: true, timestep: step };
    }
  }
  return { ok: false, timestep: -1 };
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
