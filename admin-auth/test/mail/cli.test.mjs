import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { runMailCli } from '../../src/mail/cli.mjs';
import { MAIL_ERROR_CODES } from '../../src/mail/constants.mjs';
import { MailError } from '../../src/mail/errors.mjs';

const event = {
  eventId: 'OperationsEventIdentifier01',
  check: 'public_health',
  state: 'firing',
  observedAt: '2026-07-13T00:00:00.000Z',
  summary: 'private summary for reader@example.net',
};

function outputSink() {
  let value = '';
  return {
    write(chunk) {
      value += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      return true;
    },
    text() { return value; },
  };
}

function stdinFrom(value) {
  return Readable.from([Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8')]);
}

function successLine(sent) {
  return JSON.stringify({ ok: true, sent }) + '\n';
}

function errorLine(code) {
  return JSON.stringify({ ok: false, error: { code } }) + '\n';
}

async function execute({ input = JSON.stringify(event), stdin, argv = [], service } = {}) {
  const stdout = outputSink();
  const stderr = outputSink();
  const resolvedService = service || { sendOpsEvent: async () => ({ sent: 2 }) };
  const exitCode = await runMailCli({
    stdin: stdin || stdinFrom(input), stdout, stderr, argv, service: resolvedService,
  });
  return { exitCode, stdout: stdout.text(), stderr: stderr.text() };
}

async function runCliProcess(cliPath, args, input, environment) {
  const child = spawn(process.execPath, [cliPath, ...args], {
    env: environment,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdin.end(input);
  const [exitCode] = await once(child, 'close');
  return { exitCode, stdout, stderr };
}

describe('runMailCli', () => {
  it('validates one stdin event and calls sendOpsEvent exactly once', async () => {
    const calls = [];
    const result = await execute({
      service: {
        async sendOpsEvent(value) {
          calls.push(value);
          return { sent: 2, ignored: 'not public' };
        },
      },
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, successLine(2));
    assert.equal(result.stderr, '');
    assert.deepEqual(calls, [event]);
    for (const secret of [event.summary, 'reader@example.net', 'not public']) {
      assert.equal((result.stdout + result.stderr).includes(secret), false);
    }
  });

  it('rejects empty, malformed, invalid, and oversized stdin without calling the service', async () => {
    const cases = [
      Buffer.alloc(0),
      '   ',
      '{',
      JSON.stringify({ unexpected: true, summary: event.summary }),
      Buffer.alloc(65537, 0x78),
    ];

    for (const input of cases) {
      let calls = 0;
      const result = await execute({
        input,
        service: { async sendOpsEvent() { calls += 1; return { sent: 1 }; } },
      });
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, errorLine('PAYLOAD_INVALID'));
      assert.equal(calls, 0);
      assert.equal(result.stderr.includes(event.summary), false);
    }
  });

  it('accepts exactly 65536 bytes and rejects a cross-chunk byte beyond the cap', async () => {
    const serialized = Buffer.from(JSON.stringify(event), 'utf8');
    const exact = Buffer.concat([serialized, Buffer.alloc(65536 - serialized.length, 0x20)]);
    const accepted = await execute({ input: exact });
    assert.equal(accepted.exitCode, 0);
    assert.equal(accepted.stdout, successLine(2));

    let calls = 0;
    const rejected = await execute({
      stdin: Readable.from([exact, Buffer.from(' ')]),
      service: { async sendOpsEvent() { calls += 1; return { sent: 1 }; } },
    });
    assert.equal(rejected.exitCode, 1);
    assert.equal(rejected.stdout, '');
    assert.equal(rejected.stderr, errorLine('PAYLOAD_INVALID'));
    assert.equal(calls, 0);
  });

  it('rejects invalid UTF-8 instead of silently replacing bytes', async () => {
    const marker = 'private summary marker';
    const serialized = Buffer.from(JSON.stringify({ ...event, summary: marker }), 'utf8');
    const offset = serialized.indexOf(marker);
    const invalidUtf8 = Buffer.concat([
      serialized.subarray(0, offset), Buffer.from([0xff]), serialized.subarray(offset + marker.length),
    ]);
    let calls = 0;
    const result = await execute({
      input: invalidUtf8,
      service: { async sendOpsEvent() { calls += 1; return { sent: 1 }; } },
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, errorLine('PAYLOAD_INVALID'));
    assert.equal(calls, 0);
  });

  it('maps stdin read failures to INTERNAL_ERROR without leaking stream text', async () => {
    let calls = 0;
    const result = await execute({
      stdin: {
        async *[Symbol.asyncIterator]() {
          throw new Error(`stream failure ${event.summary}`);
        },
      },
      service: { async sendOpsEvent() { calls += 1; return { sent: 1 }; } },
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, errorLine('INTERNAL_ERROR'));
    assert.equal(result.stderr.includes(event.summary), false);
    assert.equal(calls, 0);
  });

  it('rejects every positional argument before reading stdin', async () => {
    let read = false;
    let calls = 0;
    const stdin = {
      async *[Symbol.asyncIterator]() {
        read = true;
        yield Buffer.from(JSON.stringify(event));
      },
    };
    const stdout = outputSink();
    const stderr = outputSink();

    const exitCode = await runMailCli({
      stdin,
      stdout,
      stderr,
      argv: [JSON.stringify(event)],
      service: { async sendOpsEvent() { calls += 1; return { sent: 1 }; } },
    });

    assert.equal(exitCode, 1);
    assert.equal(read, false);
    assert.equal(calls, 0);
    assert.equal(stdout.text(), '');
    assert.equal(stderr.text(), errorLine('PAYLOAD_INVALID'));
  });

  it('contains hostile argv values inside PAYLOAD_INVALID', async () => {
    const { proxy, revoke } = Proxy.revocable([], {});
    revoke();
    const stdout = outputSink();
    const stderr = outputSink();

    const exitCode = await runMailCli({
      stdin: stdinFrom(JSON.stringify(event)),
      stdout,
      stderr,
      argv: proxy,
      service: { async sendOpsEvent() { return { sent: 1 }; } },
    });

    assert.equal(exitCode, 1);
    assert.equal(stdout.text(), '');
    assert.equal(stderr.text(), errorLine('PAYLOAD_INVALID'));
  });

  it('treats zero recipients as an unconfigured alert channel', async () => {
    const result = await execute({ service: { async sendOpsEvent() { return { sent: 0 }; } } });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, errorLine('MAIL_NOT_CONFIGURED'));
  });

  it('maps invalid service result counts and stdout failures to INTERNAL_ERROR', async () => {
    const hostileResult = {};
    Object.defineProperty(hostileResult, 'sent', {
      get() { throw new Error(`sent getter ${event.summary}`); },
    });
    for (const value of [
      undefined, null, { sent: '1' }, { sent: -1 }, { sent: Number.NaN },
      { sent: 1.5 }, { sent: Number.POSITIVE_INFINITY }, { sent: 2 ** 53 }, hostileResult,
    ]) {
      const result = await execute({ service: { async sendOpsEvent() { return value; } } });
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, errorLine('INTERNAL_ERROR'));
      assert.equal(result.stderr.includes(event.summary), false);
    }

    const stderr = outputSink();
    const exitCode = await runMailCli({
      stdin: stdinFrom(JSON.stringify(event)),
      stdout: { write() { throw new Error(`stdout ${event.summary}`); } },
      stderr,
      argv: [],
      service: { async sendOpsEvent() { return { sent: 1 }; } },
    });
    assert.equal(exitCode, 1);
    assert.equal(stderr.text(), errorLine('INTERNAL_ERROR'));
    assert.equal(stderr.text().includes(event.summary), false);
  });

  it('prints only allowed stable codes for MailError failures', async () => {
    for (const code of MAIL_ERROR_CODES) {
      const result = await execute({
        service: {
          async sendOpsEvent() {
            throw new MailError(code, true, new Error(`SMTP response ${event.summary}`));
          },
        },
      });
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, errorLine(code));
      assert.equal(result.stderr.includes(event.summary), false);
      assert.equal(result.stderr.includes('SMTP response'), false);
    }
  });

  it('maps unknown, mutated, and hostile service errors to INTERNAL_ERROR', async () => {
    const mutated = new MailError('SMTP_CONNECTION', true);
    mutated.code = 'SMTP provider secret';
    const hostile = new Proxy({}, {
      getPrototypeOf() { throw new Error('prototype secret'); },
    });

    for (const error of [new Error(`injected ${event.summary}`), mutated, hostile]) {
      const result = await execute({
        service: { async sendOpsEvent() { throw error; } },
      });
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, errorLine('INTERNAL_ERROR'));
      assert.equal(result.stderr.includes(event.summary), false);
      assert.equal(result.stderr.includes('secret'), false);
    }
  });

  it('keeps direct startup configuration failures and positional arguments non-sensitive', async () => {
    const cliPath = fileURLToPath(new URL('../../src/mail/cli.mjs', import.meta.url));
    const baseEnvironment = { ...process.env };
    for (const key of [
      'MAIL_INTERNAL_SECRET', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USERNAME', 'SMTP_PASSWORD',
      'SMTP_FROM_ADDRESS', 'SMTP_FROM_NAME', 'ALIYUN_SMTP_HOST', 'ALIYUN_SMTP_PORT',
      'ALIYUN_SMTP_USER', 'ALIYUN_SMTP_PASSWORD', 'ALIYUN_FROM_EMAIL', 'ALIYUN_FROM_NAME',
      'MAIL_LOCAL_TEST_MODE', 'PUBLIC_SITE_URL',
    ]) delete baseEnvironment[key];
    const canaries = ['smtp-host-canary.invalid', 'smtp-user-canary', 'smtp-password-canary'];
    const invalidEnvironment = {
      ...baseEnvironment,
      SMTP_HOST: canaries[0],
      SMTP_PORT: '587',
      SMTP_USERNAME: canaries[1],
      SMTP_PASSWORD: canaries[2],
    };

    const startup = await runCliProcess(cliPath, [], JSON.stringify(event), invalidEnvironment);
    assert.equal(startup.exitCode, 1);
    assert.equal(startup.stdout, '');
    assert.equal(startup.stderr, errorLine('INTERNAL_ERROR'));
    for (const canary of canaries) assert.equal(startup.stderr.includes(canary), false);

    const argument = JSON.stringify(event);
    const rejected = await runCliProcess(cliPath, [argument], '', invalidEnvironment);
    assert.equal(rejected.exitCode, 1);
    assert.equal(rejected.stdout, '');
    assert.equal(rejected.stderr, errorLine('PAYLOAD_INVALID'));
    assert.equal(rejected.stderr.includes(event.summary), false);
  });

  it('does not require MAIL_INTERNAL_SECRET when executed directly', async () => {
    const cliPath = fileURLToPath(new URL('../../src/mail/cli.mjs', import.meta.url));
    const environment = { ...process.env };
    for (const key of [
      'MAIL_INTERNAL_SECRET', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USERNAME', 'SMTP_PASSWORD',
      'SMTP_FROM_ADDRESS', 'SMTP_FROM_NAME', 'ALIYUN_SMTP_HOST', 'ALIYUN_SMTP_PORT',
      'ALIYUN_SMTP_USER', 'ALIYUN_SMTP_PASSWORD', 'ALIYUN_FROM_EMAIL', 'ALIYUN_FROM_NAME',
      'MAIL_LOCAL_TEST_MODE', 'PUBLIC_SITE_URL',
    ]) delete environment[key];

    const child = spawn(process.execPath, [cliPath], {
      env: environment,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdin.end(JSON.stringify(event));
    const [exitCode] = await once(child, 'close');

    assert.equal(exitCode, 1);
    assert.equal(stdout, '');
    assert.equal(stderr, errorLine('MAIL_NOT_CONFIGURED'));
    assert.equal((stdout + stderr).includes('MAIL_INTERNAL_SECRET'), false);
  });
});
