// 冒烟测试：在 Node.js 中验证 admin_totp.js 的纯 JS 实现（不依赖 $security / $os）
// 运行：node pb_hooks/lib/admin_totp.smoke.js

const crypto = require('crypto');

// ---- 从 admin_totp.js 复制核心实现（不依赖 JSVM 全局变量） ----

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
  while (out.length % 8 !== 0) out += '=';
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

function counterToBytes(counter) {
  var bytes = [0, 0, 0, 0, 0, 0, 0, 0];
  var value = counter;
  for (var i = 7; i >= 0; i--) {
    bytes[i] = value & 0xff;
    value = Math.floor(value / 256);
  }
  return bytes;
}

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
  while (text.length < 6) text = '0' + text;
  return text;
}

// ---- 测试用例 ----

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    console.error('FAIL:', label);
    console.error('  expected:', expected);
    console.error('  actual:  ', actual);
    process.exit(1);
  }
  console.log('PASS:', label);
}

// 1. Base32 编解码
console.log('=== Base32 ===');
var testBytes = [0x48, 0x65, 0x6c, 0x6c, 0x6f]; // "Hello"
var b32 = base32Encode(testBytes);
assertEqual(b32, 'JBSWY3DP', 'base32Encode("Hello")');
var decoded = base32Decode(b32);
assertEqual(JSON.stringify(decoded), JSON.stringify(testBytes), 'base32Decode roundtrip');
assertEqual(base32Decode('jbswy3dp').length, 5, 'base32Decode lowercase');
assertEqual(base32Decode('JBSW Y3DP').length, 5, 'base32Decode with space');

// 2. SHA-256 已知向量 (abc)
console.log('\n=== SHA-256 ===');
var abcHash = bytesToHex(sha256Bytes(stringToBytes('abc')));
assertEqual(abcHash, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'SHA-256("abc")');

// 空字符串
var emptyHash = bytesToHex(sha256Bytes([]));
assertEqual(emptyHash, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'SHA-256("")');

// 3. HMAC-SHA256 已知向量
console.log('\n=== HMAC-SHA256 ===');
// 向量来自 RFC 4231 Test Case 1
var hmacKey1 = hexToBytes('0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b');
var hmacMsg1 = stringToBytes('Hi There');
var hmacRes1 = bytesToHex(hmacSha256Bytes(hmacKey1, hmacMsg1));
assertEqual(hmacRes1, 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7', 'HMAC-SHA256 RFC4231 TC1');

// 4. TOTP 回归测试（固定 secret + 固定 timestep，与 Node crypto 交叉验证）
console.log('\n=== TOTP regression ===');
var secret = stringToBytes('12345678901234567890');
var timestep = 1;
var ourCode = totpAt(secret, timestep);

// 用 Node crypto 交叉验证
var nodeHmac = crypto.createHmac('sha256', Buffer.from(secret)).update(Buffer.from(counterToBytes(timestep))).digest();
var nodeOffset = nodeHmac[nodeHmac.length - 1] & 0x0f;
var nodeBinary = ((nodeHmac[nodeOffset] & 0x7f) << 24) | ((nodeHmac[nodeOffset + 1] & 0xff) << 16) | ((nodeHmac[nodeOffset + 2] & 0xff) << 8) | (nodeHmac[nodeOffset + 3] & 0xff);
var nodeCode = String(nodeBinary % 1000000).padStart(6, '0');
assertEqual(ourCode, nodeCode, 'totpAt matches Node crypto HMAC-SHA256');

// 额外 timestep 回归
var tsList = [0, 1, 2, 10, 1234567890];
for (var k = 0; k < tsList.length; k++) {
  var ts = tsList[k];
  var c1 = totpAt(secret, ts);
  var nodeH = crypto.createHmac('sha256', Buffer.from(secret)).update(Buffer.from(counterToBytes(ts))).digest();
  var off = nodeH[nodeH.length - 1] & 0x0f;
  var bin = ((nodeH[off] & 0x7f) << 24) | ((nodeH[off + 1] & 0xff) << 16) | ((nodeH[off + 2] & 0xff) << 8) | (nodeH[off + 3] & 0xff);
  var c2 = String(bin % 1000000).padStart(6, '0');
  assertEqual(c1, c2, 'totpAt timestep=' + ts);
}

// 5. otpauth URI
console.log('\n=== otpauth URI ===');
function buildOtpauthUri(base32Secret, accountName, issuer) {
  var enc = encodeURIComponent;
  var label = enc(issuer) + ':' + enc(accountName);
  return 'otpauth://totp/' + label +
    '?secret=' + base32Secret +
    '&issuer=' + enc(issuer) +
    '&algorithm=SHA256&digits=6&period=30';
}
var uri = buildOtpauthUri('JBSWY3DPEHPK3PXP', 'user@example.com', 'HubaBlog');
assertEqual(uri, 'otpauth://totp/HubaBlog:user%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=HubaBlog&algorithm=SHA256&digits=6&period=30', 'buildOtpauthUri');

console.log('\n=== 所有测试通过 ===');
