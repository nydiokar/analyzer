import 'dotenv/config';

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

function parseIdList(raw: string | undefined): number[] {
  return (raw || '')
    .split(',')
    .map(id => parseInt(id.trim(), 10))
    .filter(id => !isNaN(id) && id !== 0);
}

export const config = {
  BOT_TOKEN: required('INTEL_BOT_TOKEN'),
  INTEL_API_KEY: required('INTEL_API_KEY'),
  INTEL_BASE_URL: optional('INTEL_BASE_URL', 'http://localhost:3001/api/v1'),
  ALLOWED_USER_IDS: parseIdList(process.env.INTEL_BOT_ALLOWED_USER_IDS),
  ALLOWED_CHAT_IDS: parseIdList(process.env.INTEL_BOT_ALLOWED_CHAT_IDS),
} as const;

export type Config = typeof config;
