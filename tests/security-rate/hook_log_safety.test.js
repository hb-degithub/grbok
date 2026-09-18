'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var repoRoot = path.resolve(__dirname, '..', '..');
var expectedLogs = {
  'pb_hooks/account_mail.pb.js': '[account-mail] operation=registration-auto-send result=INTERNAL_ERROR',
  'pb_hooks/mail_outbox.pb.js': '[mail-outbox] operation=worker result=INTERNAL_ERROR',
  'pb_hooks/security_rate_cleanup.pb.js': '[security-rate] operation=cleanup result=INTERNAL_ERROR',
  'pb_hooks/send_email_comment.pb.js': '[comment-mail] operation=enqueue result=INTERNAL_ERROR',
};

// 2026-09-18 起允许的稳定后缀:截断到 200 字符的 error.message(不含 stack/对象),
// 便于排障同时不泄露内部结构。除此之外不得出现其他异常插值。
var ALLOWED_DETAIL_SUFFIX = " + String(err && err.message || err).slice(0, 200));";

Object.keys(expectedLogs).forEach(function (relativePath) {
  var source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
  assert(source.indexOf(expectedLogs[relativePath]) !== -1, relativePath + ' must log its stable error code');
  var logCalls = source.match(/console\.error\s*\([^;\n]*\);/g) || [];
  var plainCall = "console.error('" + expectedLogs[relativePath] + "');";
  var detailCall = "console.error('" + expectedLogs[relativePath] + " detail='" + ALLOWED_DETAIL_SUFFIX;
  logCalls.forEach(function (call) {
    assert(
      call === plainCall || call === detailCall,
      relativePath + ' must emit only stable literal log records (got: ' + call.slice(0, 120) + ')',
    );
  });
  assert(!/\.stack\b/.test(source), relativePath + ' must not log exception stacks');
  assert(!/console\.error\([^\n]*\$\{\s*(?:error|err)\s*\}/.test(source), relativePath + ' must not interpolate exception objects');
});

var outbox = require(path.join(repoRoot, 'pb_hooks', 'lib', 'mail_outbox.js'));

function retentionRecord(siteUrl) {
  return {
    getString: function (field) {
      if (field === 'template_key') return 'account_retention_notice';
      if (field === 'variables_json') {
        return JSON.stringify({
          displayName: 'Reader',
          cleanupDate: '2026-09-14',
          siteUrl: siteUrl,
        });
      }
      return '';
    },
    get: function () { return {}; },
  };
}

var rendered = outbox._render(retentionRecord('https://fixture.invalid/'));
var loginUrl = 'https://fixture.invalid/login';
assert(rendered.html.indexOf('href="' + loginUrl + '"') !== -1, 'retention HTML CTA must point to the fixed login route');
assert(rendered.text.indexOf(loginUrl) !== -1, 'retention text CTA must point to the fixed login route');
assert(rendered.html.indexOf('reader@example.com') === -1 && rendered.text.indexOf('reader@example.com') === -1, 'retention CTA must not contain an email address');
assert(!/[?&](?:token|email)=/i.test(rendered.html + '\n' + rendered.text), 'retention CTA must not contain token or email query data');

assert.throws(function () {
  outbox._render(retentionRecord('https://fixture.invalid/?token=sensitive'));
}, /invalid siteUrl/, 'siteUrl with query data must be rejected');

process.stdout.write('PASS hook logs use stable codes and retention CTA is fixed to trusted login\n');
