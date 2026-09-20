'use strict';

// AI 功能配置（OpenAI 兼容端点）。存储于 ai_settings 集合（单条记录，rule 全 null），
// api_key 用 PB_ENCRYPTION_KEY 派生密钥流加密（与 SMTP/ESA 凭据同一套机制）。
// 管理接口走 /api/blog-admin/ai/settings（可信管理 IP + step-up + super_admin）。
// 模式照搬 mail_smtp_config.js：resolve() 供 worker/路由内部使用（含解密 key），
// readPublic() 返回脱敏视图（绝不包含明文 key），save() 时 key 留空 = 保留原值。
//
// 环境变量兜底：AI_BASE_URL / AI_API_KEY / AI_MODEL（docker 部署时注入）。
// 注意：env 只在记录缺失对应字段时补位；enabled 必须由后台显式打开，
// 避免仅配置 env 就静默激活 AI 功能。

var totpCrypto = require('./admin_totp.js');

var COLLECTION = 'ai_settings';
var COMMENT_MODES = ['off', 'manual', 'assist', 'full_auto'];
var PUBLISH_MODES = ['draft', 'published'];
var DEFAULT_TIMEOUT = 60;
var MIN_TIMEOUT = 10;
var MAX_TIMEOUT = 110; // $http.send 同步阻塞，避免长时间占用 JSVM runtime
var MAX_BANNED_WORDS = 500;
var MAX_BANNED_WORD_LEN = 100;
var DEFAULT_REPLY_NAME = 'AI 助手';

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

function envValue(name) {
  try { return String($os.getenv(name) || '').trim(); } catch (_) { return ''; }
}

function parseBannedWordList(list) {
  if (!list || typeof list.length !== 'number') return [];
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var w = String(list[i] == null ? '' : list[i]).trim();
    if (w) out.push(w);
  }
  return out;
}

// json 字段在 PB 0.22 JSVM 下 record.get() 返回原始字节数组（词表会被读成
// ["91","34",...] 伪词），必须走 getString + JSON.parse（与 mail_outbox.js
// recordVariables 同款模式），get 返回数组的新版行为作为兜底。
function readBannedWords(record) {
  var raw = '';
  try { raw = record.getString('banned_words'); } catch (_) { raw = ''; }
  if (raw) {
    try { return parseBannedWordList(JSON.parse(raw)); } catch (_) { return []; }
  }
  try { return parseBannedWordList(record.get('banned_words')); } catch (_) { return []; }
}

function normalizeMode(value, allowed, fallback) {
  return allowed.indexOf(value) !== -1 ? value : fallback;
}

function normalizeTimeout(value) {
  var n = Number(value || 0);
  if (!Number.isSafeInteger(n) || n < MIN_TIMEOUT || n > MAX_TIMEOUT) return DEFAULT_TIMEOUT;
  return n;
}

function resolveKey(record) {
  var enc = record.getString('api_key_enc');
  if (enc) {
    try { return hexToText(totpCrypto.decryptSecret(enc)); } catch (_) { return ''; }
  }
  return envValue('AI_API_KEY');
}

// 完整配置（含解密 api_key），供 ai_client / 评论 worker 使用。
// 未启用或缺少 base_url/api_key/model 时返回 null。
function resolve(dao) {
  var record = findRecord(dao);
  if (!record || !record.getBool('enabled')) return null;
  var baseUrl = record.getString('base_url').trim() || envValue('AI_BASE_URL');
  var model = record.getString('model').trim() || envValue('AI_MODEL');
  var apiKey = resolveKey(record);
  if (!baseUrl || !model || !apiKey) return null;
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey: apiKey,
    model: model,
    timeoutSeconds: normalizeTimeout(record.get('timeout_seconds')),
    articlePublishMode: normalizeMode(record.getString('article_publish_mode'), PUBLISH_MODES, 'draft'),
    commentMode: normalizeMode(record.getString('comment_mode'), COMMENT_MODES, 'off'),
    bannedWordsEnabled: record.getBool('banned_words_enabled'),
    bannedWords: readBannedWords(record),
    replyName: record.getString('reply_name').trim() || DEFAULT_REPLY_NAME,
    replyPersona: record.getString('reply_persona').trim(),
  };
}

// 评论管线轻量视图：违禁词拦截独立于 AI 总开关（本地词表零成本），
// 因此 validate_comment 钩子在 AI 未配置时也要能读到词表与模式。
function commentPolicy(dao) {
  var record = findRecord(dao);
  if (!record) {
    return { commentMode: 'off', bannedWordsEnabled: false, bannedWords: [] };
  }
  return {
    commentMode: normalizeMode(record.getString('comment_mode'), COMMENT_MODES, 'off'),
    bannedWordsEnabled: record.getBool('banned_words_enabled'),
    bannedWords: readBannedWords(record),
  };
}

// 脱敏视图（管理界面回显用，绝不含明文 api_key）
function readPublic(dao) {
  var record = findRecord(dao);
  if (!record) {
    return {
      configured: false,
      enabled: false,
      base_url: '',
      model: '',
      timeout_seconds: DEFAULT_TIMEOUT,
      article_publish_mode: 'draft',
      comment_mode: 'off',
      banned_words_enabled: false,
      banned_words: [],
      reply_name: DEFAULT_REPLY_NAME,
      reply_persona: '',
      has_key: !!envValue('AI_API_KEY'),
      updated_at: '',
    };
  }
  return {
    configured: true,
    enabled: record.getBool('enabled'),
    base_url: record.getString('base_url'),
    model: record.getString('model'),
    timeout_seconds: normalizeTimeout(record.get('timeout_seconds')),
    article_publish_mode: normalizeMode(record.getString('article_publish_mode'), PUBLISH_MODES, 'draft'),
    comment_mode: normalizeMode(record.getString('comment_mode'), COMMENT_MODES, 'off'),
    banned_words_enabled: record.getBool('banned_words_enabled'),
    banned_words: readBannedWords(record),
    reply_name: record.getString('reply_name').trim() || DEFAULT_REPLY_NAME,
    reply_persona: record.getString('reply_persona'),
    has_key: !!record.getString('api_key_enc') || !!envValue('AI_API_KEY'),
    updated_at: record.getString('updated'),
  };
}

function invalid(message) {
  throw new ApiError(400, 'INVALID_AI_CONFIG: ' + message);
}

// base_url 必须是 http(s) URL。与 SMTP host 校验不同：这里允许 IP 字面量与
// 内网地址 —— 自建 new-api / one-api 网关常部署在局域网或同机 Docker 网络。
// SSRF 风险由路由层门槛兜底（可信管理 IP + step-up + super_admin），且该端点
// 只接收管理端构造的固定 prompt，不转发用户输入的 URL。
function validateBaseUrl(raw) {
  var url = String(raw || '').trim();
  if (!url) return '';
  if (url.length > 500 || !/^https?:\/\/[^\s]+$/i.test(url)) invalid('base_url');
  return url.replace(/\/+$/, '');
}

// input: { enabled, base_url, api_key, model, timeout_seconds, article_publish_mode,
//          comment_mode, banned_words_enabled, banned_words, reply_name, reply_persona }
// api_key 为空字符串且已有加密记录 → 保留原 key
function save(dao, input, userId) {
  var enabled = input.enabled === true;
  var baseUrl = validateBaseUrl(input.base_url);
  var model = String(input.model || '').trim();
  var apiKey = String(input.api_key || '');
  var timeout = normalizeTimeout(input.timeout_seconds);
  var articleMode = normalizeMode(input.article_publish_mode, PUBLISH_MODES, null);
  var commentMode = normalizeMode(input.comment_mode, COMMENT_MODES, null);
  var bannedEnabled = input.banned_words_enabled === true;
  var replyName = String(input.reply_name || '').trim() || DEFAULT_REPLY_NAME;
  var replyPersona = String(input.reply_persona || '').trim();

  if (model.length > 120) invalid('model');
  if (articleMode === null) invalid('article_publish_mode');
  if (commentMode === null) invalid('comment_mode');
  if (apiKey.length > 512) invalid('api_key');
  if (replyName.length > 50) invalid('reply_name');
  if (replyPersona.length > 2000) invalid('reply_persona');

  var bannedWords = [];
  if (input.banned_words != null) {
    if (!Array.isArray(input.banned_words)) invalid('banned_words');
    if (input.banned_words.length > MAX_BANNED_WORDS) invalid('banned_words');
    for (var i = 0; i < input.banned_words.length; i++) {
      var w = String(input.banned_words[i] == null ? '' : input.banned_words[i]).trim();
      if (!w) continue;
      if (w.length > MAX_BANNED_WORD_LEN) invalid('banned_words');
      bannedWords.push(w);
    }
  }

  $app.dao().runInTransaction(function (txDao) {
    var record = findRecord(txDao);
    if (!record) {
      record = new Record(txDao.findCollectionByNameOrId(COLLECTION));
    }
    var keyEnc = record.getString('api_key_enc');
    if (apiKey) {
      keyEnc = totpCrypto.encryptSecret(textToHex(apiKey));
    }
    // 启用前必须凑齐三要素（记录值或 env 兜底均可）
    if (enabled) {
      var effectiveUrl = baseUrl || envValue('AI_BASE_URL');
      var effectiveModel = model || envValue('AI_MODEL');
      var effectiveKey = keyEnc ? '<stored>' : envValue('AI_API_KEY');
      if (!effectiveUrl) invalid('base_url');
      if (!effectiveModel) invalid('model');
      if (!effectiveKey) invalid('api_key');
    }

    record.set('enabled', enabled);
    record.set('base_url', baseUrl);
    record.set('api_key_enc', keyEnc);
    record.set('model', model);
    record.set('timeout_seconds', timeout);
    record.set('article_publish_mode', articleMode);
    record.set('comment_mode', commentMode);
    record.set('banned_words_enabled', bannedEnabled);
    // json 字段直接 set 数组对象（PB 序列化存储，与 mail_outbox 的 variables_json 同款）
    record.set('banned_words', bannedWords);
    record.set('reply_name', replyName);
    record.set('reply_persona', replyPersona);
    record.set('updated_by', String(userId || ''));
    txDao.saveRecord(record);
  });

  return readPublic($app.dao());
}

module.exports = {
  resolve: resolve,
  commentPolicy: commentPolicy,
  readPublic: readPublic,
  save: save,
  COMMENT_MODES: COMMENT_MODES,
  PUBLISH_MODES: PUBLISH_MODES,
};
