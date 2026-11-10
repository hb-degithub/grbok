'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const ALLOWED = 'https://api.example.test,http://127.0.0.1:8317';
global.$os = { getenv(name) { return name === 'AI_ALLOWED_ORIGINS' ? ALLOWED : ''; } };
global.$app = { dao() { throw new Error('unexpected db access'); } };
const aiConfig = require('../../pb_hooks/lib/ai_config.js');

test('AI upstream accepts only an exact configured origin', () => {
  assert.equal(aiConfig.validateBaseUrl('https://api.example.test'), 'https://api.example.test');
  assert.equal(aiConfig.validateBaseUrl('http://127.0.0.1:8317/'), 'http://127.0.0.1:8317');
  const denied = [
    'https://api.example.test.evil.test', 'https://api.example.test:443',
    'https://user:pass@api.example.test', 'https://api.example.test/v1',
    'https://api.example.test/?next=x', 'file:///etc/passwd', 'http://169.254.169.254/',
    'http://10.0.0.1', 'not a url', '',
  ];
  for (const value of denied) assert.throws(() => aiConfig.validateBaseUrl(value), undefined, value);
});

test('AI upstream defaults to deny without an allowlist', () => {
  global.$os.getenv = () => '';
  assert.throws(() => aiConfig.validateBaseUrl('https://api.example.test'));
});

test('AI client validates a supplied cached config before any HTTP request', () => {
  global.$os.getenv = () => ALLOWED;
  global.ApiError = class ApiError extends Error {};
  let calls = 0;
  global.$http = { send() { calls++; return { statusCode: 200, json: { choices: [{ message: { content: 'ok' } }] } }; } };
  const client = require('../../pb_hooks/lib/ai_client.js');
  assert.throws(() => client.chat({ config: { baseUrl: 'http://169.254.169.254', apiKey: 'local-test-key', model: 'test' }, user: 'test' }));
  assert.equal(calls, 0);
  const result = client.chat({ config: { baseUrl: 'https://api.example.test/', apiKey: 'local-test-key', model: 'test' }, user: 'test' });
  assert.equal(result.content, 'ok');
  assert.equal(calls, 1);
});
