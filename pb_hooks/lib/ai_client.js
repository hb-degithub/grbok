'use strict';

// OpenAI 兼容端点客户端（chat/completions）。
// $http.send 为同步阻塞调用，超时取 ai_settings.timeout_seconds（默认 60s，上限 110s）。
// 错误归一化为 ApiError，code 稳定前缀 AI_，供前端错误码映射：
//   AI_NOT_CONFIGURED(400)  未启用或缺少 base_url/api_key/model
//   AI_TIMEOUT(504)         上游响应超时
//   AI_AUTH_FAILED(502)     API Key 无效（上游 401/403）
//   AI_UPSTREAM_BUSY(502)   上游限流（429）
//   AI_UPSTREAM_ERROR(502)  其他非 2xx 或网络错误
//   AI_BAD_RESPONSE(502)    响应体结构/JSON 解析失败
// 安全：错误消息绝不包含请求体；上游响应体进消息前截断 300 字符并脱敏 api_key。

var aiConfig = require('./ai_config.js');

function redact(text, apiKey) {
  var s = String(text || '');
  if (apiKey && s.indexOf(apiKey) !== -1) s = s.split(apiKey).join('***');
  if (s.length > 300) s = s.slice(0, 300) + '…';
  return s;
}

function fail(status, code, message) {
  throw new ApiError(status, code + (message ? ': ' + message : ''));
}

// 调用方可传入已 resolve 的配置，避免一次请求内重复查库+解密
function effectiveConfig(config) {
  if (config) return config;
  var cfg = aiConfig.resolve($app.dao());
  if (!cfg) fail(400, 'AI_NOT_CONFIGURED', '请先在 AI 设置中完成接入配置并启用');
  return cfg;
}

// opts: { system, user, maxTokens, temperature, config }
// 返回 { content: string, usage: object|null }
function chat(opts) {
  var cfg = effectiveConfig(opts && opts.config);
  var messages = [];
  if (opts.system) messages.push({ role: 'system', content: String(opts.system) });
  messages.push({ role: 'user', content: String(opts.user || '') });

  var payload = {
    model: cfg.model,
    messages: messages,
    temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.7,
    stream: false,
  };
  if (opts.maxTokens) payload.max_tokens = Math.floor(opts.maxTokens);

  var res = null;
  try {
    res = $http.send({
      url: cfg.baseUrl + '/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + cfg.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      timeout: cfg.timeoutSeconds,
    });
  } catch (e) {
    var msg = String((e && e.message) || e || '');
    if (/timeout|deadline|exceeded|timed out/i.test(msg)) fail(504, 'AI_TIMEOUT', '上游响应超时');
    fail(502, 'AI_UPSTREAM_ERROR', '请求失败');
  }
  if (!res) fail(502, 'AI_UPSTREAM_ERROR', '无响应');

  if (res.statusCode === 401 || res.statusCode === 403) fail(502, 'AI_AUTH_FAILED', 'API Key 无效或未授权');
  if (res.statusCode === 429) fail(502, 'AI_UPSTREAM_BUSY', '上游限流，请稍后重试');
  if (res.statusCode < 200 || res.statusCode >= 300) {
    fail(502, 'AI_UPSTREAM_ERROR', 'HTTP ' + res.statusCode + ' ' + redact(res.raw, cfg.apiKey));
  }

  var data = res.json;
  var content = '';
  try {
    content = String(data.choices[0].message.content || '');
  } catch (_) {
    content = '';
  }
  if (!content.trim()) fail(502, 'AI_BAD_RESPONSE', '响应缺少 choices[0].message.content');
  return { content: content, usage: (data && data.usage) || null };
}

// JSON 模式：剥掉 ```json 围栏后解析；模型未按约定输出时抛 AI_BAD_RESPONSE
function chatJson(opts) {
  var result = chat(opts);
  var text = result.content.trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  var data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    // 部分模型会在 JSON 前后补解释文字，尝试截取首个对象字面量
    var start = text.indexOf('{');
    var end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try { data = JSON.parse(text.slice(start, end + 1)); } catch (_) { data = null; }
    }
    if (!data) fail(502, 'AI_BAD_RESPONSE', 'JSON 解析失败');
  }
  return { data: data, usage: result.usage };
}

module.exports = {
  chat: chat,
  chatJson: chatJson,
};
