import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// 回归：AI 助手「配置校验失败」（INVALID_AI_CONFIG）的生产根因是 validateBaseUrl
// 只接受裸 origin，线上 base_url = https://newapi.hbdfwqmbhk.com/v1 被直接判 invalid。
// 本文件用 node --test 加载 pb_hooks/lib/ai_config.js（CJS）验证：
//   1. 允许带路径，且路径规范化（去尾斜杠、保留内部路径）；
//   2. origin 仍与 AI_ALLOWED_ORIGINS 精确比对（大小写不敏感、忽略尾斜杠）；
//   3. 凭证 / 查询串 / hash / 空白 / .. / 非法端口仍然拒绝；
//   4. AI_ALLOWED_ORIGINS 为空时 fail-closed；
//   5. save() 落库并返回规范化 base_url，resolve() 读到同一规范化值。

const ALLOWED = 'https://newapi.example.test,http://127.0.0.1:8317,https://[::1]:9000';

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
  class ApiError extends Error {
    constructor(status, message, data) {
      super(message);
      this.status = status;
      this.data = data;
    }
  }
  // save() / readPublic() 都是单条记录语义：给一个可读可写的记录桩即可。
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
  return { aiConfig: module.exports, record, environment };
}

test('base_url accepts a path and keeps the allowlisted origin', async () => {
  const { aiConfig } = await loadAiConfig();

  assert.equal(aiConfig.validateBaseUrl('https://newapi.example.test/v1'), 'https://newapi.example.test/v1');
  assert.equal(aiConfig.validateBaseUrl('https://newapi.example.test/openai/v1'), 'https://newapi.example.test/openai/v1');
  // 裸 origin 行为不变（历史配置/测试继续通过）
  assert.equal(aiConfig.validateBaseUrl('https://newapi.example.test'), 'https://newapi.example.test');
  // origin 大小写不敏感，路径大小写保留（路径区分大小写）
  assert.equal(aiConfig.validateBaseUrl('https://NEWAPI.Example.TEST/V1'), 'https://newapi.example.test/V1');
  // 端口与 IPv6 行为保持
  assert.equal(aiConfig.validateBaseUrl('http://127.0.0.1:8317/v1'), 'http://127.0.0.1:8317/v1');
  assert.equal(aiConfig.validateBaseUrl('https://[::1]:9000/v1'), 'https://[::1]:9000/v1');
});

test('base_url normalizes trailing slashes and only compares the origin with the allowlist', async () => {
  const { aiConfig } = await loadAiConfig();

  for (const value of ['https://newapi.example.test/v1/', 'https://newapi.example.test/v1//']) {
    assert.equal(aiConfig.validateBaseUrl(value), 'https://newapi.example.test/v1', value);
  }
  // 仅尾斜杠的裸 origin
  assert.equal(aiConfig.validateBaseUrl('https://newapi.example.test/'), 'https://newapi.example.test');
  // 白名单条目自身的尾斜杠 / 大小写不影响匹配
  const trimmed = await loadAiConfig({ allowed: ' HTTPS://NewAPI.example.test/ ' });
  assert.equal(trimmed.aiConfig.validateBaseUrl('https://newapi.example.test/v1/'), 'https://newapi.example.test/v1');
});

test('base_url still rejects credentials, query, hash, whitespace, traversal and bad ports', async () => {
  const { aiConfig } = await loadAiConfig();
  const denied = [
    // 非白名单 origin（路径不得放宽 origin 校验）
    'https://evil.example.test/v1',
    'https://newapi.example.test.evil.test/v1',
    'https://newapi.example.test:443/v1',
    // 凭证
    'https://user:pass@newapi.example.test/v1',
    'https://user@newapi.example.test/v1',
    // 查询串 / hash
    'https://newapi.example.test/v1?x=1',
    'https://newapi.example.test/v1#f',
    'https://newapi.example.test/?x=1',
    // 空白 / 反斜杠（URL 解析器会把 \ 归一成 /）
    'https://newapi.example.test /v1',
    'https://newapi example.test/v1',
    'https://newapi.example.test/a\\..\\b',
    // 路径穿越（含百分号编码）
    'https://newapi.example.test/v1/..',
    'https://newapi.example.test/../v1',
    'https://newapi.example.test/a/%2e%2e/b',
    'https://newapi.example.test/a/%2E%2E/b',
    // 端口
    'https://newapi.example.test:0/v1',
    'https://newapi.example.test:65536/v1',
    'https://newapi.example.test:abc/v1',
    'https://newapi.example.test:/v1',
    // 协议 / 形态
    'file:///etc/passwd',
    'ftp://newapi.example.test/v1',
    'not a url',
    '',
    'https:///v1',
  ];
  for (const value of denied) {
    assert.throws(() => aiConfig.validateBaseUrl(value), /INVALID_AI_CONFIG: base_url/, value);
  }
});

test('base_url stays fail-closed when AI_ALLOWED_ORIGINS is empty', async () => {
  for (const allowed of ['', '   ', ',,']) {
    const { aiConfig } = await loadAiConfig({ allowed });
    assert.throws(() => aiConfig.validateBaseUrl('https://newapi.example.test/v1'), /INVALID_AI_CONFIG: base_url/, allowed);
    assert.throws(() => aiConfig.validateBaseUrl('https://newapi.example.test'), /INVALID_AI_CONFIG: base_url/, allowed);
  }
  // 白名单条目本身必须是 origin：带路径的条目不会被当作 origin 接受
  const pathEntry = await loadAiConfig({ allowed: 'https://newapi.example.test/v1' });
  assert.throws(() => pathEntry.aiConfig.validateBaseUrl('https://newapi.example.test/v1'), /INVALID_AI_CONFIG: base_url/);
});

test('save() persists and returns the normalized base_url', async () => {
  const record = createRecord({ enabled: false, base_url: '', model: '', api_key_enc: '' });
  const { aiConfig } = await loadAiConfig({ record });

  const saved = aiConfig.save(
    null,
    {
      enabled: false,
      base_url: 'https://newapi.example.test/v1/',
      model: 'gpt-4o-mini',
      timeout_seconds: 30,
      article_publish_mode: 'draft',
      comment_mode: 'off',
      banned_words_enabled: false,
      banned_words: [],
      reply_name: 'AI 助手',
      reply_persona: '',
    },
    'admin-user',
  );

  assert.equal(saved.base_url, 'https://newapi.example.test/v1');
  assert.equal(record.values.base_url, 'https://newapi.example.test/v1');
  assert.equal(record.values.model, 'gpt-4o-mini');
});

test('resolve() hands the normalized base_url (with path) to the AI client', async () => {
  const record = createRecord({
    enabled: true,
    base_url: 'https://newapi.example.test/v1/',
    model: 'gpt-4o-mini',
    timeout_seconds: 30,
  });
  const { aiConfig } = await loadAiConfig({ record, env: { AI_API_KEY: 'local-test-key' } });

  const config = aiConfig.resolve(null);
  assert.ok(config, 'resolve() must return a config for an enabled record');
  assert.equal(config.baseUrl, 'https://newapi.example.test/v1');
  assert.equal(config.model, 'gpt-4o-mini');
});
