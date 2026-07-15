'use strict';

var PLACEHOLDER_PATTERN = /{{([A-Za-z][A-Za-z0-9_]*)}}/g;
var SUBJECT_MAX = 255;
var HTML_MAX_BYTES = 262144;
var TEXT_MAX_BYTES = 131072;
var ORIGIN_PATTERN = /^(https?):\/\/([^\/?#]+)/i;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function utf8ByteLength(str) {
  var len = 0;
  var i = 0;
  while (i < str.length) {
    var code = str.charCodeAt(i);
    if (code < 0x80) { len += 1; i += 1; }
    else if (code < 0x800) { len += 2; i += 1; }
    else if (code >= 0xD800 && code <= 0xDBFF) { len += 4; i += 2; }
    else { len += 3; i += 1; }
  }
  return len;
}

function parseJsonArray(text, fieldName) {
  var parsed;
  try { parsed = JSON.parse(text); }
  catch (e) { throw new Error('invalid ' + fieldName + ': JSON parse failed'); }
  if (!Array.isArray(parsed)) {
    throw new Error('invalid ' + fieldName + ': expected array');
  }
  return parsed;
}

function parseJsonObject(text, fieldName) {
  var parsed;
  try { parsed = JSON.parse(text); }
  catch (e) { throw new Error('invalid ' + fieldName + ': JSON parse failed'); }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('invalid ' + fieldName + ': expected object');
  }
  return parsed;
}

function extractOrigin(rawUrl) {
  var match = ORIGIN_PATTERN.exec(rawUrl);
  if (!match) return null;
  return { scheme: match[1].toLowerCase(), host: match[2].toLowerCase() };
}

function getSiteOrigin() {
  var url = String($os.getenv('PUBLIC_SITE_URL') || '').trim();
  if (!url) throw new Error('PUBLIC_SITE_URL is not configured');
  var origin = extractOrigin(url);
  if (!origin) throw new Error('PUBLIC_SITE_URL is not a valid http(s) URL');
  if (origin.scheme === 'https') return origin;
  if (origin.scheme === 'http' && (origin.host === 'localhost' || origin.host === '127.0.0.1')) return origin;
  throw new Error('PUBLIC_SITE_URL must use https in production; http only for localhost');
}

function validateActionOrigin(rawUrl, baseOrigin) {
  var origin = extractOrigin(rawUrl);
  if (!origin) throw new Error('action URL is not a valid http(s) URL');
  if (origin.scheme !== baseOrigin.scheme) throw new Error('action URL scheme mismatch');
  if (origin.host !== baseOrigin.host) throw new Error('action URL host mismatch');
  if (origin.scheme === 'https') return;
  if (origin.host !== 'localhost' && origin.host !== '127.0.0.1') {
    throw new Error('http action URLs only allowed on localhost');
  }
}

function replacePlaceholders(template, variables, escapeFn) {
  return template.replace(PLACEHOLDER_PATTERN, function (_, name) {
    if (Object.prototype.hasOwnProperty.call(variables, name)) {
      return escapeFn(variables[name]);
    }
    return '';
  });
}

function buildHtml(content, vars, actionUrl) {
  var parts = [];
  parts.push('<!DOCTYPE html>');
  parts.push('<html lang="zh-CN"><head><meta charset="utf-8">');
  parts.push('<meta name="viewport" content="width=device-width,initial-scale=1">');
  parts.push('<title>' + escapeHtml(vars.subject || '') + '</title>');
  parts.push('</head><body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">');
  parts.push('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:24px 0;">');
  parts.push('<tr><td align="center">');
  parts.push('<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;max-width:600px;">');

  var preheader = content.preheader ? replacePlaceholders(content.preheader, vars, escapeHtml) : '';
  if (preheader) {
    parts.push('<tr><td style="display:none;max-height:0;overflow:hidden;opacity:0;">' + preheader + '</td></tr>');
  }

  var title = content.title ? replacePlaceholders(content.title, vars, escapeHtml) : '';
  parts.push('<tr><td style="padding:32px 40px 8px;">');
  parts.push('<h1 style="margin:0 0 16px;font-size:22px;color:#1a1a1a;">' + title + '</h1>');
  parts.push('</td></tr>');

  if (Array.isArray(content.paragraphs)) {
    for (var i = 0; i < content.paragraphs.length; i++) {
      parts.push('<tr><td style="padding:4px 40px;">');
      parts.push('<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#333;">' +
        replacePlaceholders(String(content.paragraphs[i]), vars, escapeHtml) + '</p>');
      parts.push('</td></tr>');
    }
  }

  if (actionUrl) {
    var label = (content.action && content.action.label) ? String(content.action.label) : '\u7ee7\u7eed';
    parts.push('<tr><td style="padding:16px 40px;">');
    parts.push('<a href="' + escapeHtml(actionUrl) + '" style="display:inline-block;padding:12px 32px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-size:15px;">' + escapeHtml(label) + '</a>');
    parts.push('</td></tr>');
    parts.push('<tr><td style="padding:0 40px 8px;">');
    parts.push('<p style="margin:0;font-size:13px;color:#666;word-break:break-all;">' + escapeHtml(actionUrl) + '</p>');
    parts.push('</td></tr>');
  }

  if (content.footer) {
    parts.push('<tr><td style="padding:24px 40px 32px;border-top:1px solid #eee;">');
    parts.push('<p style="margin:0;font-size:12px;color:#999;">' + escapeHtml(String(content.footer)) + '</p>');
    parts.push('</td></tr>');
  }

  parts.push('</table></td></tr></table></body></html>');
  return parts.join('');
}

function buildText(content, vars, actionUrl) {
  var lines = [];
  var title = content.title ? replacePlaceholders(content.title, vars, escapeText) : '';
  if (title) lines.push(title);
  lines.push('');

  if (Array.isArray(content.paragraphs)) {
    for (var i = 0; i < content.paragraphs.length; i++) {
      lines.push(replacePlaceholders(String(content.paragraphs[i]), vars, escapeText));
    }
  }

  if (actionUrl) {
    var label = (content.action && content.action.label) ? String(content.action.label) : '\u7ee7\u7eed';
    lines.push('');
    lines.push(escapeText(label) + ': ' + actionUrl);
  }

  if (content.footer) {
    lines.push('');
    lines.push(escapeText(String(content.footer)));
  }

  return lines.join('\n');
}

function render(key, variables) {
  if (typeof key !== 'string' || !key) {
    throw new Error('template key must be a non-empty string');
  }
  if (typeof variables !== 'object' || variables === null || Array.isArray(variables)) {
    throw new Error('variables must be a plain object');
  }

  var records = $app.dao().findRecordsByFilter(
    'mail_templates',
    'key = {:key} && is_current = true',
    '-created',
    1,
    0,
    { key: key }
  );
  if (!records || records.length === 0) {
    throw new Error('template not found: ' + key);
  }
  var template = records[0];

  var declaredVariables = parseJsonArray(
    template.getString('variables_json'), 'variables_json'
  );
  var requiredVariables = parseJsonArray(
    template.getString('required_variables_json'), 'required_variables_json'
  );

  var declaredSet = {};
  for (var i = 0; i < declaredVariables.length; i++) {
    declaredSet[declaredVariables[i]] = true;
  }

  for (var name in variables) {
    if (Object.prototype.hasOwnProperty.call(variables, name)) {
      if (!declaredSet[name]) {
        throw new Error('undeclared variable: ' + name);
      }
    }
  }

  for (var j = 0; j < requiredVariables.length; j++) {
    var reqName = requiredVariables[j];
    if (!Object.prototype.hasOwnProperty.call(variables, reqName)) {
      throw new Error('missing required variable: ' + reqName);
    }
  }

  var subjectTemplate = template.getString('subject_template');
  var subject = replacePlaceholders(subjectTemplate, variables, function (v) { return String(v); });
  if (subject.length > SUBJECT_MAX) {
    subject = subject.slice(0, SUBJECT_MAX);
  }

  var mergedVariables = {};
  for (var k in variables) {
    if (Object.prototype.hasOwnProperty.call(variables, k)) {
      mergedVariables[k] = String(variables[k]);
    }
  }
  mergedVariables.subject = subject;

  var content = parseJsonObject(template.getString('content_json'), 'content_json');

  var actionUrl = null;
  if (content.action && typeof content.action === 'object') {
    var urlVar = content.action.urlVariable;
    if (typeof urlVar !== 'string' || !urlVar) {
      throw new Error('action.urlVariable must be a non-empty string');
    }
    if (!declaredSet[urlVar] && urlVar !== 'subject') {
      throw new Error('action.urlVariable not declared: ' + urlVar);
    }
    var rawActionUrl = mergedVariables[urlVar];
    if (typeof rawActionUrl !== 'string' || !rawActionUrl) {
      throw new Error('action URL variable is empty: ' + urlVar);
    }
    var siteOrigin = getSiteOrigin();
    validateActionOrigin(rawActionUrl, siteOrigin);
    actionUrl = rawActionUrl;
  }

  var html = buildHtml(content, mergedVariables, actionUrl);
  if (utf8ByteLength(html) > HTML_MAX_BYTES) {
    throw new Error('rendered HTML exceeds maximum size');
  }

  var text = buildText(content, mergedVariables, actionUrl);
  if (utf8ByteLength(text) > TEXT_MAX_BYTES) {
    throw new Error('rendered text exceeds maximum size');
  }

  return {
    category: template.getString('category'),
    subject: subject,
    html: html,
    text: text,
    version: template.getInt('version'),
  };
}

module.exports = {
  render: render,
  escapeHtml: escapeHtml,
};