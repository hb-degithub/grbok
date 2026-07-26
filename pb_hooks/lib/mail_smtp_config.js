'use strict';

// 后台可配置的 SMTP 设置（阿里云邮件推送等）。
// 存储于 mail_smtp_settings 集合（单条记录），密码用 PB_ENCRYPTION_KEY 派生密钥流加密。
// 读取优先级高于 admin-auth 的环境变量配置：存在且 enabled 时，随 /internal/mail/* 请求
// 携带完整配置，admin-auth 按请求参数即时建立连接，保存即生效、无需重启容器。

var totpCrypto = require('./admin_totp.js');

var COLLECTION = 'mail_smtp_settings';
var TLS_MODES = ['auto', 'implicit', 'starttls'];
var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
var HOST_RE = /^[a-z0-9](?:[a-z0-9.-]{0,251})[a-z0-9]$/i;
var IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;
var INTERNAL_HOST_NAMES = { localhost: true };
var INTERNAL_HOST_SUFFIXES = ['.internal', '.local', '.lan'];

// SMTP override 的目标必须是公网 MTA 域名，拒绝 IP 字面量与内网/元数据地址，
// 防止 SSRF（云环境可窃 IAM 元数据）。判定逻辑与 admin-auth/src/mail/validation.mjs
// 的 isRejectedSmtpHost 保持一致（PB 侧与 admin-auth 侧共用同一规则）。
// 与 mail_gateway.js 的 isInternalHost（PB→admin-auth 内部调用"只允许内网"）相反：
// 这里是 admin-auth→外部 MTA，"只允许公网域名"。
function rejectSmtpHost(rawHost) {
  if (typeof rawHost !== 'string') return true;
  var host = String(rawHost).trim().toLowerCase();
  if (!host) return true;
  // IPv6 字面量（含 :），形如 [::1] 或 ::1 / fe80::1
  if (host.indexOf(':') !== -1) return true;
  // IPv4 字面量：拒绝所有（含 169.254.169.254 元数据、127.0.0.1、10/172.16/192.168）
  if (IPV4_RE.test(host)) return true;
  // 显式内部主机名
  if (INTERNAL_HOST_NAMES[host]) return true;
  // 单标签主机名（不含点，如 admin-auth、pb、mailhog）——公网 SMTP 域名必含点
  if (host.indexOf('.') === -1) return true;
  // 内部后缀
  for (var i = 0; i < INTERNAL_HOST_SUFFIXES.length; i++) {
    var suffix = INTERNAL_HOST_SUFFIXES[i];
    if (host.length >= suffix.length && host.substr(host.length - suffix.length) === suffix) return true;
  }
  return false;
}

// ---------- text <-> hex（Unicode 安全，每字符 4 位 hex，配合 XOR 流加密）----------
function textToHex(text) {
  var s = String(text);
  var out = '';
  for (var i = 0; i < s.length; i++) {
    var h = s.charCodeAt(i).toString(16);
    while (h.length < 4) h = '0' + h;
    out += h;
  }
  return out;
}

function hexToText(hex) {
  var out = '';
  for (var i = 0; i + 4 <= hex.length; i += 4) {
    out += String.fromCharCode(parseInt(hex.substr(i, 4), 16));
  }
  return out;
}

function findRecord(dao) {
  var rows = (dao || $app.dao()).findRecordsByFilter(COLLECTION, '1=1', '', 1, 0, {});
  return rows && rows.length ? rows[0] : null;
}

// 完整配置（含解密密码），供 gateway 发送时使用；未配置或未启用返回 null
function resolve(dao) {
  var record = findRecord(dao);
  if (!record || !record.getBool('enabled')) return null;
  var host = record.getString('host').trim();
  var port = Number(record.get('port') || 0);
  var fromAddress = record.getString('from_address').trim();
  if (!host || !port || !fromAddress) return null;
  var password = '';
  var enc = record.getString('password_enc');
  if (enc) {
    try {
      password = hexToText(totpCrypto.decryptSecret(enc));
    } catch (_) {
      return null;
    }
  }
  var username = record.getString('username').trim();
  if (!username || !password) return null; // 用户名密码必须成对
  return {
    host: host,
    port: port,
    username: username,
    password: password,
    fromAddress: fromAddress,
    fromName: record.getString('from_name').trim() || '个人博客',
    tlsMode: TLS_MODES.indexOf(record.getString('tls_mode')) !== -1 ? record.getString('tls_mode') : 'auto',
  };
}

// 脱敏视图（管理界面回显用，绝不含密码）
function readPublic(dao) {
  var record = findRecord(dao);
  if (!record) {
    return {
      configured: false, enabled: false, host: '', port: 465, username: '',
      from_address: '', from_name: '', tls_mode: 'auto', has_password: false, updated_at: '',
    };
  }
  return {
    configured: true,
    enabled: record.getBool('enabled'),
    host: record.getString('host'),
    port: Number(record.get('port') || 465),
    username: record.getString('username'),
    from_address: record.getString('from_address'),
    from_name: record.getString('from_name'),
    tls_mode: record.getString('tls_mode') || 'auto',
    has_password: !!record.getString('password_enc'),
    updated_at: record.getString('updated'),
  };
}

function invalid(message) {
  throw new ApiError(400, 'INVALID_SMTP_CONFIG: ' + message);
}

// input: { host, port, username, password, from_address, from_name, tls_mode, enabled }
// password 为空字符串且已有记录 → 保留原密码
function save(dao, input, userId) {
  var host = String(input.host || '').trim().toLowerCase();
  var port = Number(input.port || 0);
  var username = String(input.username || '').trim();
  var password = String(input.password || '');
  var fromAddress = String(input.from_address || '').trim();
  var fromName = String(input.from_name || '').trim();
  var tlsMode = String(input.tls_mode || 'auto').trim();
  var enabled = input.enabled === true;

  if (!HOST_RE.test(host) || host.indexOf('..') !== -1) invalid('host');
  if (rejectSmtpHost(host)) invalid('host');
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) invalid('port');
  if (!EMAIL_RE.test(fromAddress)) invalid('from_address');
  if (TLS_MODES.indexOf(tlsMode) === -1) invalid('tls_mode');
  if (fromName.length > 120) invalid('from_name');
  if (password.length > 512) invalid('password');

  $app.dao().runInTransaction(function (txDao) {
    var record = findRecord(txDao);
    if (!record) {
      record = new Record(txDao.findCollectionByNameOrId(COLLECTION));
    }
    var passwordEnc = record.getString('password_enc');
    if (password) {
      passwordEnc = totpCrypto.encryptSecret(textToHex(password));
    }
    if (!passwordEnc) invalid('password'); // 首次保存必须提供密码
    if (!username) invalid('username');

    record.set('host', host);
    record.set('port', port);
    record.set('username', username);
    record.set('password_enc', passwordEnc);
    record.set('from_address', fromAddress);
    record.set('from_name', fromName);
    record.set('tls_mode', tlsMode);
    record.set('enabled', enabled);
    record.set('updated_by', String(userId || ''));
    txDao.saveRecord(record);
  });

  return readPublic($app.dao());
}

module.exports = {
  resolve: resolve,
  readPublic: readPublic,
  save: save,
  rejectSmtpHost: rejectSmtpHost,
};
