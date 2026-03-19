import fs from 'fs';
import path from 'path';

const OPENCLAW_DIR = path.resolve('/Users/evmbp/poker-game/clients/openclaw');
const SERVER_DIR = path.resolve('/Users/evmbp/poker-game/server');
const SERVER_ENV_PATH = path.join(SERVER_DIR, '.env');

function parseEnvFile(filePath) {
  const values = {};

  if (!fs.existsSync(filePath)) {
    return values;
  }

  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    values[key] = value;
  }

  return values;
}

const serverEnv = parseEnvFile(SERVER_ENV_PATH);

function getEnv(name, fallback = undefined) {
  if (process.env[name] !== undefined) return process.env[name];
  if (serverEnv[name] !== undefined) return serverEnv[name];
  return fallback;
}

function getDbConfig() {
  return {
    host: getEnv('DB_HOST', 'localhost'),
    port: parseInt(getEnv('DB_PORT', '5432'), 10),
    database: getEnv('DB_NAME', 'poker_game'),
    user: getEnv('DB_USER', 'postgres'),
    password: getEnv('DB_PASSWORD', ''),
  };
}

export {
  OPENCLAW_DIR,
  SERVER_DIR,
  SERVER_ENV_PATH,
  getEnv,
  getDbConfig,
};
