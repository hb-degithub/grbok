import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// 回归：AI 配置保存失败的诊断能力（2026-11 生产缺陷）。
//
// 生产现象：ai_settings 记录从 2026-09 起未再更新（enabled=0），保存请求没落库，
// 但接口只回 'INVALID_AI_CONFIG: <field>' 字符串，前端无法定位是哪一项没过校验。
// 本文件用 node --test 直接加载 pb_hooks/lib/ai_config.js（CJS）验证：
//   1. invalid() 抛 HTTP 400 + data:{ code:'INVALID_AI_CONFIG', field }，message 保留可读原因；
//   2. diagnostics(input) 是不写库的纯函数，逐项返回 [{ field, reason }]；
//   3. 诊断结论与 save() 的拒绝口径一致（enabled 时 base_url/model/api_key 必填）。

const ALLOWED = 'https://newapi.example.test,http://127.0.0.1:8317';

function createRecord(initial = {}) {
  const values = { ...initial };
  return {
    values,
    getString(name) {
      return typeof values[name] === 'string' ? values[name] : '';
    },
    getBool(name) {
      return values[name] === true;
    },
    get(name) {
      return values[name];
    },
    set(name, value) {
      values[name] = value;
    },
  };
}

async function loadAiConfig({ allowed = ALLOWED, record = null, env = {} } = {}) {
  const source = await readFile(new URL('../../pb_hooks/lib/ai_config.js', import.meta.url), 'utf8');
  const environment = { AI_ALLOWED_ORIGINS: allowed, ...env };
  const module = { exports: {} };
  const warnings = [];
  class ApiError extends Error {
    constructor(status, message, data) {
      super(message);
      this.status = status;
      this.data = data;
    }
  }
  const dao = {
    findRecordsByFilter() {
      return record ? [record] : [];
    },
    findFirstRecordByFilter() {
      if (!record) throw new Error('not found');
      return record;
    },
    runInTransaction(fn) {
      return fn(dao);
    },
    saveRecord() {},
    findCollectionByNameOrId() {
      return { name: 'ai_settings' };
    },
  };
  const context = vm.createContext({
    module,
    exports: module.exports,
    ApiError,
    Record: class Record {},
    console: {
      log() {},
      warn(...args) {
        warnings.push(args.join(' '));
      },
      error() {},
    },
    $app: { dao: () => dao },
    $os: {
      getenv(name) {
        return Object.prototype.hasOwnProperty.call(environment, name) ? environment[name] : '';
      },
    },
    require(name) {
      if (name === './admin_totp.js') return {};
      throw new Error('unexpected require in ai_config.js: ' + name);
    },
  });
  vm.runInContext(source, context, { filename: 'ai_config.js' });
  return { aiConfig: module.exports, record, environment, warnings };
}

// vm 沙箱里创建的数组来自另一个 realm，deepStrictEqual 会因原型不同失败，
// 因此这里用 Array.from 在外层 realm 重新构造。
function fields(errors) {
  return Array.from(errors, (item) => item.field);
}

const VALID_FORM = {
  enabled: true,
  base_url: 'http://127.0.0.1:8317/v1',
  api_key: 'sk-local-diagnostics',
  model: 'gpt-4o-mini',
  timeout_seconds: 30,
  article_publish_mode: 'draft',
  comment_mode: 'off',
  banned_words_enabled: false,
  banned_words: [],
  reply_name: 'AI 助手',
  reply_persona: '',
};

test('invalid() throws a structured 400 with the failing field and a readable reason', async () => {
  const { aiConfig, warnings } = await loadAiConfig();

  let caught = null;
  try {
    aiConfig.validateBaseUrl('https://evil.example.test/v1');
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, 'validateBaseUrl must reject a non-allowlisted origin');
  assert.equal(caught.status, 400);
  assert.equal(caught.data.code, 'INVALID_AI_CONFIG');
  assert.equal(caught.data.field, 'base_url');
  assert.match(caught.data.reason, /AI_ALLOWED_ORIGINS/);
  // message 前缀保持不变（前端 aiErrorCode / 既有回归测试依赖它），并带上可读原因
  assert.match(caught.message, /^INVALID_AI_CONFIG: base_url/);
  assert.match(caught.message, /AI_ALLOWED_ORIGINS/);
  // 便于从 PB 日志按字段定位
  assert.ok(warnings.some((line) => line.includes('invalid field=base_url')), warnings.join('\n'));
});

test('diagnostics() reports missing required fields when enabled', async () => {
  const { aiConfig } = await loadAiConfig();

  const report = aiConfig.diagnostics({});
  assert.equal(report.ok, false);
  assert.deepEqual(fields(report.errors), ['base_url']);

  const enabled = aiConfig.diagnostics({ enabled: true });
  assert.equal(enabled.ok, false);
  assert.deepEqual(fields(enabled.errors).sort(), ['api_key', 'base_url', 'model']);
  for (const item of enabled.errors) assert.ok(item.reason.length > 0, 'every error needs a reason');
});

test('diagnostics() accepts a fully valid form without writing anything', async () => {
  const { aiConfig, record } = await loadAiConfig();

  const report = aiConfig.diagnostics(VALID_FORM);
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  assert.equal(report.errors.length, 0);
  // 纯函数：不触碰记录
  assert.equal(record, null);
});

test('diagnostics() points at an illegal base_url (format vs allowlist)', async () => {
  const { aiConfig } = await loadAiConfig();

  const notAllowed = aiConfig.diagnostics({ ...VALID_FORM, base_url: 'https://evil.example.test/v1' });
  assert.deepEqual(fields(notAllowed.errors), ['base_url']);
  assert.match(notAllowed.errors[0].reason, /AI_ALLOWED_ORIGINS/);
  assert.match(notAllowed.errors[0].reason, /evil\.example\.test/);

  const malformed = aiConfig.diagnostics({ ...VALID_FORM, base_url: 'not a url' });
  assert.deepEqual(fields(malformed.errors), ['base_url']);
  assert.match(malformed.errors[0].reason, /格式非法/);

  const traversal = aiConfig.diagnostics({ ...VALID_FORM, base_url: 'http://127.0.0.1:8317/v1/..' });
  assert.deepEqual(fields(traversal.errors), ['base_url']);

  // 带路径的白名单地址仍然通过（生产配置 https://newapi.hbdfwqmbhk.com/v1 的形态）
  const withPath = aiConfig.diagnostics({ ...VALID_FORM, base_url: 'http://127.0.0.1:8317/openai/v1' });
  assert.equal(withPath.ok, true, JSON.stringify(withPath.errors));
});

test('diagnostics() reports invalid enums, timeout, nickname, persona and banned words', async () => {
  const { aiConfig } = await loadAiConfig();

  const report = aiConfig.diagnostics({
    ...VALID_FORM,
    article_publish_mode: 'immediately',
    comment_mode: 'sometimes',
    timeout_seconds: 5,
    reply_name: 'x'.repeat(51),
    reply_persona: 'y'.repeat(2001),
    banned_words: ['ok', 'z'.repeat(101)],
  });
  assert.equal(report.ok, false);
  assert.deepEqual(fields(report.errors).sort(), [
    'article_publish_mode',
    'banned_words',
    'comment_mode',
    'reply_name',
    'reply_persona',
    'timeout_seconds',
  ]);

  const tooManyWords = [];
  for (let i = 0; i < 501; i++) tooManyWords.push('w' + i);
  const overflow = aiConfig.diagnostics({ ...VALID_FORM, banned_words: tooManyWords });
  assert.deepEqual(fields(overflow.errors), ['banned_words']);

  const notArray = aiConfig.diagnostics({ ...VALID_FORM, banned_words: 'spam' });
  assert.deepEqual(fields(notArray.errors), ['banned_words']);

  // 边界值通过：timeout 10/110、model 120 字、昵称 50 字、人设 2000 字
  const bounds = aiConfig.diagnostics({
    ...VALID_FORM,
    timeout_seconds: 110,
    model: 'm'.repeat(120),
    reply_name: 'n'.repeat(50),
    reply_persona: 'p'.repeat(2000),
    banned_words: ['spam', '  '],
  });
  assert.equal(bounds.ok, true, JSON.stringify(bounds.errors));
});

test('diagnostics() honours has_key so a stored/env key is not reported missing', async () => {
  const { aiConfig } = await loadAiConfig();

  const withStoredKey = aiConfig.diagnostics({
    ...VALID_FORM,
    api_key: '',
    has_key: true,
  });
  assert.equal(withStoredKey.ok, true, JSON.stringify(withStoredKey.errors));

  const noKey = aiConfig.diagnostics({ ...VALID_FORM, api_key: '', has_key: false });
  assert.deepEqual(fields(noKey.errors), ['api_key']);
});

test('diagnostics() agrees with save(): what it flags is what save() rejects', async () => {
  const record = createRecord({ enabled: false, base_url: '', model: '', api_key_enc: '' });
  const { aiConfig, warnings } = await loadAiConfig({ record });

  let caught = null;
  try {
    aiConfig.save(null, { ...VALID_FORM, model: 'm'.repeat(121) }, 'admin-user');
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, 'save() must reject an over-long model');
  assert.equal(caught.status, 400);
  assert.equal(caught.data.field, 'model');
  assert.equal(caught.data.code, 'INVALID_AI_CONFIG');
  assert.match(caught.message, /^INVALID_AI_CONFIG: model/);
  assert.ok(warnings.some((line) => line.includes('invalid field=model')), warnings.join('\n'));

  // 诊断对同一份表单给出同一个字段
  const report = aiConfig.diagnostics({ ...VALID_FORM, model: 'm'.repeat(121) });
  assert.deepEqual(fields(report.errors), ['model']);
});
