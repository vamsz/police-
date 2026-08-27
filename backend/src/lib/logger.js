'use strict';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function emit(level, message, context) {
  if (LEVELS[level] < threshold) return;
  const line = { ts: new Date().toISOString(), level, message, ...context };
  const stream = level === 'error' || level === 'warn' ? console.error : console.log;
  stream(JSON.stringify(line));
}

module.exports = {
  debug: (message, context) => emit('debug', message, context),
  info: (message, context) => emit('info', message, context),
  warn: (message, context) => emit('warn', message, context),
  error: (message, context) => emit('error', message, context),
};
