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
var MAX_MODEL_LEN = 120;
var MAX_API_KEY_LEN = 512;
var MAX_REPLY_NAME_LEN = 50;
var MAX_REPLY_PERSONA_LEN = 2000;
var MAX_BASE_URL_LEN = 500;

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
    baseUrl: validateBaseUrl(baseUrl),
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

// 各字段的可读失败原因（诊断接口与 save() 共用；调用方可用第二个参数覆盖更具体的原因）。
var FIELD_REASONS = {
  base_url: 'base_url 必须是合法的 http(s) 地址，且 origin 在 AI_ALLOWED_ORIGINS 白名单内',
  model: 'model 不能超过 ' + MAX_MODEL_LEN + ' 个字符',
  api_key: 'api_key 不能超过 ' + MAX_API_KEY_LEN + ' 个字符',
  article_publish_mode: 'article_publish_mode 只能是 draft 或 published',
  comment_mode: 'comment_mode 只能是 ' + COMMENT_MODES.join(' / '),
  timeout_seconds: 'timeout_seconds 必须是 ' + MIN_TIMEOUT + '-' + MAX_TIMEOUT + ' 之间的整数',
  reply_name: 'reply_name 不能超过 ' + MAX_REPLY_NAME_LEN + ' 个字符',
  reply_persona: 'reply_persona 不能超过 ' + MAX_REPLY_PERSONA_LEN + ' 个字符',
  banned_words: 'banned_words 必须是最多 ' + MAX_BANNED_WORDS + ' 项、每项不超过 ' + MAX_BANNED_WORD_LEN + ' 字符的字符串数组',
  config: '配置值不合法',
};

// 结构化配置错误：HTTP 400，响应体 data = { code: 'INVALID_AI_CONFIG', field, reason }。
// message 保留 'INVALID_AI_CONFIG: <field>' 前缀（前端 aiErrorCode / 既有回归测试依赖该前缀）。
// 同时打 console.warn，方便在 PB 日志里按 field 定位是哪一项没过校验。
function invalid(field, reason) {
  var name = String(field || 'config');
  var detail = String(reason || FIELD_REASONS[name] || FIELD_REASONS.config);
  try { console.warn('[ai-config] invalid field=' + name + ' reason=' + detail); } catch (_) {}
  throw new ApiError(400, 'INVALID_AI_CONFIG: ' + name + ' (' + detail + ')', {
    code: 'INVALID_AI_CONFIG',
    field: name,
    reason: detail,
  });
}

// parseBaseUrl 只做**格式**校验，失败抛普通 Error（内部信号）；
// 对外的 ApiError 由 validateBaseUrl / diagnoseBaseUrl 统一给出结构化原因，
// 这样诊断接口可以在不触发 console.warn 的前提下收集全部字段错误。
function baseUrlFormatError() {
  throw new Error('AI_BASE_URL_INVALID');
}

// 把 base_url 解析成 { origin, path }。
// - 只允许 http/https；
// - origin（scheme+host+port）沿用历史校验：拒绝凭证 user@、查询串、hash、空白，
//   IPv6 方括号与端口范围检查保持不变；
// - 允许携带路径（自建 new-api / one-api 网关常见 .../v1、.../openai/v1），
//   但拒绝 .. 段（含百分号编码形态），并去掉尾部斜杠后保留内部路径。
function parseBaseUrl(raw) {
  var value = String(raw || '').trim();
  if (!value || value.length > MAX_BASE_URL_LEN) baseUrlFormatError();
  // 反斜杠一并拒绝：WHATWG URL 解析器会把特殊 scheme 里的 \ 归一成 /
  // （https://host/a\..\b 等价于 /a/../b），会绕过下面的 .. 段检查。
  if (/[\s?#\\]/.test(value)) baseUrlFormatError();
  var schemeMatch = /^(https?):\/\//i.exec(value);
  if (!schemeMatch) baseUrlFormatError();
  var rest = value.slice(schemeMatch[0].length);
  var slash = rest.indexOf('/');
  var authority = slash === -1 ? rest : rest.slice(0, slash);
  var path = slash === -1 ? '' : rest.slice(slash);
  if (!authority || authority.indexOf('@') !== -1) baseUrlFormatError();

  var host = '';
  var port = '';
  if (authority.charAt(0) === '[') {
    var end = authority.indexOf(']');
    if (end < 0) baseUrlFormatError();
    host = authority.slice(0, end + 1).toLowerCase();
    port = authority.slice(end + 1);
    if (port && !/^:[0-9]+$/.test(port)) baseUrlFormatError();
  } else {
    var colon = authority.lastIndexOf(':');
    if (colon !== -1) {
      host = authority.slice(0, colon).toLowerCase();
      port = authority.slice(colon);
      if (!/^:[0-9]+$/.test(port)) baseUrlFormatError();
    } else host = authority.toLowerCase();
  }
  if (!host || !/^[a-z0-9._-]+$|^\[[0-9a-f:]+\]$/.test(host)) baseUrlFormatError();
  if (port && (Number(port.slice(1)) < 1 || Number(port.slice(1)) > 65535)) baseUrlFormatError();

  if (path) {
    var segments = path.split('/');
    for (var i = 0; i < segments.length; i++) {
      var decoded = segments[i];
      // 非法 % 序列无法解码时按原样比较（URL 解析器本身也容忍这种路径）
      try { decoded = decodeURIComponent(decoded); } catch (_) { decoded = segments[i]; }
      var parts = decoded.split('/');
      for (var j = 0; j < parts.length; j++) {
        if (parts[j] === '..') baseUrlFormatError();
      }
    }
    while (path.length > 1 && path.charAt(path.length - 1) === '/') path = path.slice(0, -1);
    if (path === '/') path = '';
  }

  return {
    origin: schemeMatch[1].toLowerCase() + '://' + host + port,
    path: path,
  };
}

// base_url 的 origin 必须与 AI_ALLOWED_ORIGINS 中显式配置的 origin 精确匹配
// （大小写不敏感、忽略尾斜杠）；路径不参与白名单比对，仅规范化后随 origin 一起保存。
// 自建 new-api / one-api 网关须显式加入白名单；空配置默认拒绝（fail-closed）。
// 该校验不代替受信上游的重定向/DNS 管理与容器出口网络控制。
function isAllowedOrigin(origin) {
  var configured = envValue('AI_ALLOWED_ORIGINS').split(',');
  for (var i = 0; i < configured.length; i++) {
    var allowed = configured[i].trim().toLowerCase().replace(/\/+$/, '');
    if (!allowed || !/^https?:\/\/[^\/?#\s]+$/.test(allowed)) continue;
    if (allowed === origin) return true;
  }
  return false;
}

// 诊断版 base_url 校验（不抛错，供 diagnostics 收集具体原因）：
//   { ok, parse_ok, origin_allowed, origin, value, reason }
// ok 为 true 时 value 是归一化后的地址（origin + 规范路径）。
function diagnoseBaseUrl(raw) {
  var value = String(raw == null ? '' : raw).trim();
  if (!value) {
    return { ok: false, parse_ok: false, origin_allowed: false, origin: '', value: '', reason: 'base_url 不能为空' };
  }
  var parsed = null;
  try {
    parsed = parseBaseUrl(value);
  } catch (_) {
    return {
      ok: false,
      parse_ok: false,
      origin_allowed: false,
      origin: '',
      value: '',
      reason: 'base_url 格式非法：只允许 http(s) 地址，且不能包含凭证、查询串、# 片段、空白或 .. 路径穿越',
    };
  }
  if (!isAllowedOrigin(parsed.origin)) {
    return {
      ok: false,
      parse_ok: true,
      origin_allowed: false,
      origin: parsed.origin,
      value: '',
      reason: 'base_url 的 origin（' + parsed.origin + '）不在 AI_ALLOWED_ORIGINS 白名单内',
    };
  }
  return {
    ok: true,
    parse_ok: true,
    origin_allowed: true,
    origin: parsed.origin,
    value: parsed.origin + parsed.path,
    reason: '',
  };
}

// 抛出版：格式或白名单任一不满足 → ApiError 400 + data:{code:'INVALID_AI_CONFIG', field:'base_url'}。
function validateBaseUrl(raw) {
  var check = diagnoseBaseUrl(raw);
  if (!check.ok) invalid('base_url', check.reason);
  return check.value;
}

// 纯函数：对「表单值」逐项跑与 save() 相同的校验，返回 { ok, errors:[{field, reason}] }。
// 不写库、不改状态、不抛错 —— 供管理接口在保存前或保存失败时给出可定位的字段级原因。
//
// input: { enabled, base_url, api_key, model, timeout_seconds, article_publish_mode,
//          comment_mode, banned_words_enabled, banned_words, reply_name, reply_persona,
//          has_key }
//   - api_key 为空字符串表示「沿用已保存的 key」（与 save() 一致）；
//   - has_key 由调用方从脱敏视图（readPublic）带入，诊断路径不接触明文 key。
// enabled === true 时 base_url / model / api_key 三者必填（与 save() 的启用校验一致）；
// 未启用时允许留空，但一旦提供了值就必须合法（格式 / 长度 / 枚举）。
function diagnostics(input) {
  var form = input && typeof input === 'object' ? input : Object.create(null);
  var errors = [];
  var enabled = form.enabled === true;

  function add(field, reason) {
    errors.push({ field: String(field), reason: String(reason) });
  }

  // base_url：格式 + origin 白名单。save() 一进来就 validateBaseUrl(input.base_url)，
  // 空值同样被拒（env 兜底发生在校验之后），因此这里对空值一律报错，保证诊断结论与保存一致。
  var rawBaseUrl = String(form.base_url == null ? '' : form.base_url).trim();
  if (!rawBaseUrl) {
    add('base_url', 'base_url 不能为空');
  } else {
    var urlCheck = diagnoseBaseUrl(rawBaseUrl);
    if (!urlCheck.ok) add('base_url', urlCheck.reason);
  }

  // model：非空（启用时）+ 长度
  var model = String(form.model == null ? '' : form.model).trim();
  if (model.length > MAX_MODEL_LEN) add('model', FIELD_REASONS.model);
  else if (!model && enabled) add('model', '启用 AI 功能时 model 不能为空');

  // api_key：长度 + 启用时必须存在（新填，或库里/env 已有）
  var apiKey = String(form.api_key == null ? '' : form.api_key);
  var hasKey = form.has_key === true || apiKey.length > 0;
  if (apiKey.length > MAX_API_KEY_LEN) add('api_key', FIELD_REASONS.api_key);
  else if (!hasKey && enabled) add('api_key', '启用 AI 功能时需要提供 api_key（留空会沿用已保存的 key）');

  // 模式枚举：未提供视为「不修改」，不判错
  if (form.article_publish_mode !== undefined && form.article_publish_mode !== null) {
    if (PUBLISH_MODES.indexOf(String(form.article_publish_mode)) === -1) {
      add('article_publish_mode', FIELD_REASONS.article_publish_mode);
    }
  }
  if (form.comment_mode !== undefined && form.comment_mode !== null) {
    if (COMMENT_MODES.indexOf(String(form.comment_mode)) === -1) {
      add('comment_mode', FIELD_REASONS.comment_mode);
    }
  }

  // 超时：未提供跳过；提供了就必须是闭区间内的整数（接受数字字符串）
  if (form.timeout_seconds !== undefined && form.timeout_seconds !== null && form.timeout_seconds !== '') {
    var timeout = Number(form.timeout_seconds);
    if (!Number.isSafeInteger(timeout) || timeout < MIN_TIMEOUT || timeout > MAX_TIMEOUT) {
      add('timeout_seconds', FIELD_REASONS.timeout_seconds);
    }
  }

  // 昵称 / 人设长度（save() 对空昵称回落默认值，因此只有超长算错误）
  var replyName = String(form.reply_name == null ? '' : form.reply_name).trim() || DEFAULT_REPLY_NAME;
  if (replyName.length > MAX_REPLY_NAME_LEN) add('reply_name', FIELD_REASONS.reply_name);
  var replyPersona = String(form.reply_persona == null ? '' : form.reply_persona).trim();
  if (replyPersona.length > MAX_REPLY_PERSONA_LEN) add('reply_persona', FIELD_REASONS.reply_persona);

  // 违禁词表：数组形状 + 条数 + 单项长度（空白项会被 save() 忽略，不算错误）
  if (form.banned_words !== undefined && form.banned_words !== null) {
    var words = form.banned_words;
    if (!Array.isArray(words)) {
      add('banned_words', FIELD_REASONS.banned_words);
    } else if (words.length > MAX_BANNED_WORDS) {
      add('banned_words', FIELD_REASONS.banned_words);
    } else {
      for (var i = 0; i < words.length; i++) {
        var word = String(words[i] == null ? '' : words[i]).trim();
        if (word && word.length > MAX_BANNED_WORD_LEN) {
          add('banned_words', FIELD_REASONS.banned_words);
          break;
        }
      }
    }
  }

  return { ok: errors.length === 0, errors: errors };
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

  if (model.length > MAX_MODEL_LEN) invalid('model');
  if (articleMode === null) invalid('article_publish_mode');
  if (commentMode === null) invalid('comment_mode');
  if (apiKey.length > MAX_API_KEY_LEN) invalid('api_key');
  if (replyName.length > MAX_REPLY_NAME_LEN) invalid('reply_name');
  if (replyPersona.length > MAX_REPLY_PERSONA_LEN) invalid('reply_persona');

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
  validateBaseUrl: validateBaseUrl,
  diagnoseBaseUrl: diagnoseBaseUrl,
  isAllowedOrigin: isAllowedOrigin,
  diagnostics: diagnostics,
  resolve: resolve,
  commentPolicy: commentPolicy,
  readPublic: readPublic,
  save: save,
  COMMENT_MODES: COMMENT_MODES,
  PUBLISH_MODES: PUBLISH_MODES,
  MAX_MODEL_LEN: MAX_MODEL_LEN,
  MAX_API_KEY_LEN: MAX_API_KEY_LEN,
};
