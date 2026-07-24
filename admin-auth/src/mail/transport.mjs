export function createMailTransport({ config, nodemailer, logger = () => {}, clock = Date.now }) {
  const localMode = config.localTestMode === true;
  const options = {
    host: config.host,
    port: config.port,
    secure: localMode ? false : config.secure,
    requireTLS: localMode ? false : config.requireTLS,
    ...(localMode ? {} : { auth: { user: config.username, pass: config.password } }),
    connectionTimeout: config.connectionTimeoutMs,
    greetingTimeout: config.connectionTimeoutMs,
    socketTimeout: config.socketTimeoutMs,
    tls: {
      minVersion: 'TLSv1.2',
      servername: config.host,
    },
  };
  const smtp = nodemailer.createTransport(options);

  return {
    async send(payload) {
      const startedAt = Number(clock());
      try {
        const result = await smtp.sendMail({
          from: { name: config.fromName, address: config.fromAddress },
          to: payload.to,
          messageId: stableMessageId(payload.messageId, config.fromDomain),
          subject: payload.subject,
          html: payload.html,
          text: payload.text,
        });
        writeLog(logger, payload, durationSince(clock, startedAt), 'ok');
        return result;
      } catch (error) {
        writeLog(logger, payload, durationSince(clock, startedAt), 'error');
        throw error;
      }
    },

    verify() {
      return smtp.verify();
    },
  };
}

function stableMessageId(value, fromDomain) {
  const local = value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
  return `<${local}@${fromDomain}>`;
}

function durationSince(clock, startedAt) {
  try {
    const duration = Number(clock()) - startedAt;
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  } catch {
    return 0;
  }
}

function writeLog(logger, payload, duration, result) {
  const entry = {
    requestId: payload.requestId,
    category: payload.category,
    duration,
    result,
  };
  try {
    if (typeof logger === 'function') {
      logger(entry);
    } else if (logger && typeof logger.info === 'function') {
      logger.info(entry);
    }
  } catch {
    // Delivery outcome must not change when best-effort logging is unavailable.
  }
}
