import nodemailer from 'nodemailer';
import { argv as processArgv, env, stderr as processStderr, stdin as processStdin, stdout as processStdout } from 'node:process';
import { pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';
import { createMailConfig } from './config.mjs';
import { MAIL_ERROR_CODES } from './constants.mjs';
import { MailError } from './errors.mjs';
import { createMailService } from './service.mjs';
import { createMailTransport } from './transport.mjs';
import { validateOpsEvent } from './validation.mjs';

const MAX_STDIN_BYTES = 65536;

export async function runMailCli({ stdin, stdout, stderr, argv = [], service }) {
  if (!hasNoArguments(argv)) {
    writeError(stderr, 'PAYLOAD_INVALID');
    return 1;
  }

  try {
    const rawInput = await readStdin(stdin);
    const event = validateOpsEvent(parseEvent(rawInput));
    const result = await service.sendOpsEvent(event);
    const sent = result?.sent;
    if (sent === 0) throw new MailError('MAIL_NOT_CONFIGURED', false);
    if (!Number.isSafeInteger(sent) || sent < 0) {
      throw new MailError('INTERNAL_ERROR', false);
    }
    if (!writeJson(stdout, { ok: true, sent })) {
      writeError(stderr, 'INTERNAL_ERROR');
      return 1;
    }
    return 0;
  } catch (error) {
    writeError(stderr, stableErrorCode(error));
    return 1;
  }
}

function hasNoArguments(argv) {
  try {
    return Array.isArray(argv) && argv.length === 0;
  } catch {
    return false;
  }
}

async function readStdin(stdin) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_STDIN_BYTES) {
      throw new MailError('PAYLOAD_INVALID', false);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total);
}

function parseEvent(rawInput) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(rawInput);
    return JSON.parse(text);
  } catch (error) {
    throw new MailError('PAYLOAD_INVALID', false, error);
  }
}

function stableErrorCode(error) {
  try {
    if (error instanceof MailError) {
      const code = error.code;
      if (MAIL_ERROR_CODES.includes(code)) return code;
    }
  } catch {
    // Hostile thrown values must not escape the stable CLI boundary.
  }
  return 'INTERNAL_ERROR';
}

function writeError(stderr, code) {
  writeJson(stderr, { ok: false, error: { code } });
}

function writeJson(stream, value) {
  try {
    stream.write(JSON.stringify(value) + '\n');
    return true;
  } catch {
    return false;
  }
}

async function runDirectMailCli() {
  const cliArgv = processArgv.slice(2);
  if (cliArgv.length !== 0) {
    return runMailCli({
      stdin: processStdin,
      stdout: processStdout,
      stderr: processStderr,
      argv: cliArgv,
      service: null,
    });
  }

  try {
    const config = createMailConfig(env);
    const transport = createMailTransport({ config, nodemailer });
    const service = createMailService({ config, transport });
    return await runMailCli({
      stdin: processStdin,
      stdout: processStdout,
      stderr: processStderr,
      argv: cliArgv,
      service,
    });
  } catch (error) {
    writeError(processStderr, stableErrorCode(error));
    return 1;
  }
}

if (processArgv[1] && import.meta.url === pathToFileURL(processArgv[1]).href) {
  process.exitCode = await runDirectMailCli();
}
