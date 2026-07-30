import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describePurgeTasks, EsaError, purgeCaches, signRpcRequest } from '../../src/esa/client.mjs';

const credentials = Object.freeze({
  accessKeyId: 'test-access-key-id',
  accessKeySecret: 'test-access-key-secret',
  siteId: 123456789,
});

function percentEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/\+/g, '%20')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~');
}

function expectedSignature({ accessKeySecret, action, params, nonce, timestamp }) {
  const all = {
    Format: 'JSON',
    Version: '2024-09-10',
    AccessKeyId: 'test-access-key-id',
    SignatureMethod: 'HMAC-SHA1',
    Timestamp: timestamp,
    SignatureVersion: '1.0',
    SignatureNonce: nonce,
    Action: action,
    ...params,
  };
  const query = Object.keys(all)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(all[key])}`)
    .join('&');
  const stringToSign = `POST&%2F&${percentEncode(query)}`;
  return createHmac('sha1', `${accessKeySecret}&`).update(stringToSign, 'utf8').digest('base64');
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetch(impl) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return impl(url, init);
  };
  return calls;
}

afterEach(() => {
  delete globalThis.fetch;
});

describe('esa client signRpcRequest', () => {
  it('produces RFC3986-style sorted query and HMAC-SHA1 signature', () => {
    const nonce = 'fixed-nonce-123';
    const timestamp = '2026-07-28T08:00:00Z';
    const params = { SiteId: '123456789', Type: 'purgeall', Content: '{"PurgeAll":true}' };
    const { query, signature } = signRpcRequest({
      accessKeyId: credentials.accessKeyId,
      accessKeySecret: credentials.accessKeySecret,
      action: 'PurgeCaches',
      params,
      nonce,
      timestamp,
    });

    assert.ok(query.includes('Action=PurgeCaches'));
    assert.ok(query.includes('SignatureMethod=HMAC-SHA1'));
    assert.ok(query.includes('Version=2024-09-10'));
    assert.ok(query.indexOf('Action=') < query.indexOf('SiteId='), 'query must be sorted by key');
    const expected = expectedSignature({
      accessKeySecret: credentials.accessKeySecret,
      action: 'PurgeCaches',
      params,
      nonce,
      timestamp,
    });
    assert.equal(signature, expected);
  });
});

describe('esa client purgeCaches', () => {
  it('sends purgeall payload and returns taskId', async () => {
    const calls = stubFetch(async () => jsonResponse(200, { TaskId: '99887766', RequestId: 'req-1' }));
    const result = await purgeCaches({ credentials, type: 'purgeall', urls: [] });

    assert.equal(result.ok, true);
    assert.equal(result.taskId, '99887766');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://esa.cn-hangzhou.aliyuncs.com/');
    const body = calls[0].init.body;
    assert.match(body, /Action=PurgeCaches/);
    assert.match(body, /Type=purgeall/);
    assert.match(body, /SiteId=123456789/);
    assert.match(body, /Signature=/);
    assert.match(body, /Content=%7B%22PurgeAll%22%3Atrue%7D/);
  });

  it('sends file purge payload with URL list', async () => {
    const calls = stubFetch(async () => jsonResponse(200, { TaskId: '1', RequestId: 'r' }));
    const urls = ['https://hlydwz.com/stats/', 'https://hlydwz.com/about/'];
    await purgeCaches({ credentials, type: 'file', urls });

    const body = decodeURIComponent(calls[0].init.body);
    assert.match(body, /Type=file/);
    const content = /Content=(\{.*?\})(?:&|$)/.exec(body)[1];
    assert.deepEqual(JSON.parse(content), { Files: urls });
  });

  it('sends directory purge payload with Force=true', async () => {
    const calls = stubFetch(async () => jsonResponse(200, { TaskId: '2', RequestId: 'r' }));
    const urls = ['https://hlydwz.com/posts/'];
    await purgeCaches({ credentials, type: 'directory', urls });

    const body = decodeURIComponent(calls[0].init.body);
    const content = /Content=(\{.*?\})(?:&|$)/.exec(body)[1];
    assert.deepEqual(JSON.parse(content), { Directories: urls, Force: true });
  });

  it('rejects invalid urls', async () => {
    await assert.rejects(
      purgeCaches({ credentials, type: 'file', urls: ['http://evil.example/x'] }),
      (error) => error instanceof EsaError && error.code === 'ESA_PAYLOAD_INVALID',
    );
    await assert.rejects(
      purgeCaches({ credentials, type: 'file', urls: [] }),
      (error) => error.code === 'ESA_PAYLOAD_INVALID',
    );
  });

  it('rejects missing credentials', async () => {
    await assert.rejects(
      purgeCaches({ credentials: null, type: 'purgeall', urls: [] }),
      (error) => error.code === 'ESA_NOT_CONFIGURED',
    );
    await assert.rejects(
      purgeCaches({ credentials: { accessKeyId: 'x', accessKeySecret: 'y', siteId: -1 }, type: 'purgeall', urls: [] }),
      (error) => error.code === 'ESA_NOT_CONFIGURED',
    );
  });

  it('maps quota and rate-limit upstream errors to stable codes', async () => {
    stubFetch(async () => jsonResponse(400, { Code: 'QuotaExceeded.PurgeFile', Message: 'daily quota exceeded' }));
    await assert.rejects(
      purgeCaches({ credentials, type: 'purgeall', urls: [] }),
      (error) => error.code === 'ESA_QUOTA_EXCEEDED' && error.retryable === false,
    );

    stubFetch(async () => jsonResponse(429, { Code: 'TooManyRequests', Message: 'slow down' }));
    await assert.rejects(
      purgeCaches({ credentials, type: 'purgeall', urls: [] }),
      (error) => error.code === 'ESA_RATE_LIMITED' && error.retryable === true,
    );
  });

  it('maps network failures to retryable upstream error', async () => {
    stubFetch(async () => {
      throw new Error('socket hang up');
    });
    await assert.rejects(
      purgeCaches({ credentials, type: 'purgeall', urls: [] }),
      (error) => error.code === 'ESA_UPSTREAM_ERROR' && error.retryable === true,
    );
  });
});

describe('esa client describePurgeTasks', () => {
  it('maps upstream task list to stable shape', async () => {
    stubFetch(async () => jsonResponse(200, {
      RequestId: 'req-2',
      Tasks: [{ TaskId: '99887766', Status: 'Complete', Type: 'file', Process: '100%', Error: '', Description: '', CreationTime: '2026-07-28T08:01:00Z' }],
    }));
    const result = await describePurgeTasks({ credentials, taskId: '99887766' });

    assert.equal(result.ok, true);
    assert.equal(result.tasks.length, 1);
    assert.equal(result.tasks[0].taskId, '99887766');
    assert.equal(result.tasks[0].status, 'Complete');
    assert.equal(result.tasks[0].process, '100%');
  });

  it('rejects malformed taskId', async () => {
    await assert.rejects(
      describePurgeTasks({ credentials, taskId: 'not-a-number' }),
      (error) => error.code === 'ESA_PAYLOAD_INVALID',
    );
  });
});
