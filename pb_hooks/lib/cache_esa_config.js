'use strict';

// ESA 缓存刷新凭证配置（esa_purge_settings 单条集合）
// 加密模式与 mail_smtp_config.js 一致：admin_totp.js encryptSecret（AES-CTR + HMAC），
// 集合无 API 规则，仅 hook 内访问，任何接口不回传明文 Secret。

var totpCrypto = require('./admin_totp.js');

var COLLECTION = 'esa_purge_settings';

var LIMITS = {
  accessKeyId: 128,
  accessKeySecret: 512,
  siteIdMax: 9007199254740991,
};

function error(code) {
  var e = new Error(code);
  e.code = code;
  return e;
}

function textToHex(value) {
  var bytes = [];
  var text = String(value);
  for (var i = 0; i < text.length; i++) {
    var code = text.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6));
      bytes.push(0x80 | (code & 0x3f));
    } else if (code < 0xd800 || code >= 0xe000) {
      bytes.push(0xe0 | (code >> 12));
      bytes.push(0x80 | ((code >> 6) & 0x3f));
      bytes.push(0x80 | (code & 0x3f));
    } else {
      i++;
      var codePoint = 0x10000 + (((code & 0x3ff) << 10) | (text.charCodeAt(i) & 0x3ff));
      bytes.push(0xf0 | (codePoint >> 18));
      bytes.push(0x80 | ((codePoint >> 12) & 0x3f));
      bytes.push(0x80 | ((codePoint >> 6) & 0x3f));
      bytes.push(0x80 | (codePoint & 0x3f));
    }
  }
  return bytes.map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
}

function hexToText(hex) {
  var value = String(hex);
  var bytes = [];
  for (var i = 0; i < value.length; i += 2) {
    bytes.push(parseInt(value.substr(i, 2), 16));
  }
  var text = '';
  for (var j = 0; j < bytes.length; j++) {
    var b = bytes[j];
    if (b < 0x80) {
      text += String.fromCharCode(b);
    } else if (b >= 0xc0 && b < 0xe0) {
      text += String.fromCharCode(((b & 0x1f) << 6) | (bytes[++j] & 0x3f));
    } else if (b >= 0xe0 && b < 0xf0) {
      text += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[++j] & 0x3f) << 6) | (bytes[++j] & 0x3f));
    } else if (b >= 0xf0) {
      var codePoint = ((b & 0x07) << 18) | ((bytes[++j] & 0x3f) << 12) | ((bytes[++j] & 0x3f) << 6) | (bytes[++j] & 0x3f);
      var offset = codePoint - 0x10000;
      text += String.fromCharCode(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff));
    }
  }
  return text;
}

function findRecord(dao) {
  var records = dao.findRecordsByFilter(COLLECTION, 'id != ""', '-created', 1, 0);
  return records && records.length ? records[0] : null;
}

function decryptField(record, field) {
  var enc = String(record.getString(field) || '').trim();
  if (!enc) return '';
  try {
    return hexToText(totpCrypto.decryptSecret(enc));
  } catch (_) {
    return '';
  }
}

function validAccessKeyId(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= LIMITS.accessKeyId;
}

function validSiteId(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= LIMITS.siteIdMax;
}

function maskAccessKeyId(value) {
  var text = String(value || '');
  if (text.length <= 8) return text ? text.slice(0, 2) + '***' : '';
  return text.slice(0, 4) + '***' + text.slice(-4);
}

// 完整凭证（仅服务端内部使用）；未配置/未启用/解密失败返回 null
function resolve(dao) {
  try {
    var record = findRecord(dao);
    if (!record) return null;
    if (record.getBool('enabled') !== true) return null;
    var accessKeyId = String(record.getString('access_key_id') || '').trim();
    var siteId = record.getInt('site_id');
    var accessKeySecret = decryptField(record, 'access_key_secret_enc');
    if (!validAccessKeyId(accessKeyId) || !validSiteId(siteId) || !accessKeySecret) return null;
    return { accessKeyId: accessKeyId, accessKeySecret: accessKeySecret, siteId: siteId };
  } catch (_) {
    return null;
  }
}

// 管理端脱敏视图
function readPublic(dao) {
  var record = null;
  try {
    record = findRecord(dao);
  } catch (_) {
    record = null;
  }
  if (!record) {
    return { configured: false, enabled: false, accessKeyId: '', siteId: 0, hasSecret: false, updatedAt: '' };
  }
  var accessKeyId = String(record.getString('access_key_id') || '');
  return {
    configured: validAccessKeyId(accessKeyId) && validSiteId(record.getInt('site_id')) && String(record.getString('access_key_secret_enc') || '').length > 0,
    enabled: record.getBool('enabled') === true,
    accessKeyId: maskAccessKeyId(accessKeyId),
    siteId: record.getInt('site_id'),
    hasSecret: String(record.getString('access_key_secret_enc') || '').length > 0,
    updatedAt: String(record.getString('updated') || ''),
  };
}

// input: {accessKeyId, accessKeySecret(可空=保留原值), siteId, enabled}
function save(dao, input, userId) {
  if (!input || typeof input !== 'object') throw error('ESA_CONFIG_INVALID');
  var accessKeyId = String(input.accessKeyId || '').trim();
  var secret = typeof input.accessKeySecret === 'string' ? input.accessKeySecret.trim() : '';
  var siteId = Number(input.siteId);
  var enabled = input.enabled === true;

  if (!validAccessKeyId(accessKeyId)) throw error('ESA_CONFIG_INVALID');
  if (!validSiteId(siteId)) throw error('ESA_CONFIG_INVALID');
  if (secret.length > LIMITS.accessKeySecret) throw error('ESA_CONFIG_INVALID');

  var record = findRecord(dao);
  if (!secret && (!record || !String(record.getString('access_key_secret_enc') || ''))) {
    throw error('ESA_CONFIG_INVALID');
  }

  var collection = dao.findCollectionByNameOrId(COLLECTION);
  if (!record) record = new Record(collection);
  record.set('access_key_id', accessKeyId);
  if (secret) {
    record.set('access_key_secret_enc', totpCrypto.encryptSecret(textToHex(secret)));
  }
  record.set('site_id', siteId);
  record.set('enabled', enabled);
  record.set('updated_by', String(userId || ''));
  dao.saveRecord(record);
  return readPublic(dao);
}

module.exports = {
  resolve: resolve,
  readPublic: readPublic,
  save: save,
};
