// ============================================================
// Structured Logger
// ============================================================

function serializeError(error) {
  if (!error) return undefined;

  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
}

function write(level, event, fields = {}) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  };

  if (payload.error instanceof Error) {
    payload.error = serializeError(payload.error);
  }

  const line = JSON.stringify(payload);

  if (level === 'error') {
    console.error(line);
    return;
  }

  if (level === 'warn') {
    console.warn(line);
    return;
  }

  console.log(line);
}

module.exports = {
  debug(event, fields) {
    write('debug', event, fields);
  },
  info(event, fields) {
    write('info', event, fields);
  },
  warn(event, fields) {
    write('warn', event, fields);
  },
  error(event, fields) {
    write('error', event, fields);
  },
};
