import 'dotenv/config';

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const config = {
  BOT_SEED: required('BOT_SEED'),

  ANALYZER_API_URL: optional('ANALYZER_API_URL', 'http://localhost:3001/api/v1'),
  ANALYZER_API_KEY: required('ANALYZER_API_KEY'),

  SCAN_INTERVAL_MS: parseInt(optional('SCAN_INTERVAL_MS', '5000'), 10),
  MIN_PAYMENT_PFT: parseInt(optional('MIN_PAYMENT_PFT', '100'), 10),

  JOB_POLL_INTERVAL_MS: parseInt(optional('JOB_POLL_INTERVAL_MS', '15000'), 10),
  JOB_TIMEOUT_MS: parseInt(optional('JOB_TIMEOUT_MS', '600000'), 10),

  // Liveness ping interval in ms. Set to 0 to disable.
  PING_INTERVAL_MS: parseInt(optional('PING_INTERVAL_MS', '900000'), 10),

  CURSOR_FILE: optional('CURSOR_FILE', './data/cursor.json'),
  PENDING_JOBS_FILE: optional('PENDING_JOBS_FILE', './data/pending-jobs.json'),
} as const;

export const COMMAND_PRICES: Record<string, number> = {
  '/holders': parseInt(optional('PRICE_HOLDERS', '1000'), 10),
  '/profile': parseInt(optional('PRICE_PROFILE', '500'), 10),
  '/analyze': parseInt(optional('PRICE_ANALYZE', '3000'), 10),
  '/compare': parseInt(optional('PRICE_COMPARE', '3000'), 10),
};

export const HELP_TEXT = `Available commands:

/holders <mint>    — Top holders with behavioral profiles (${COMMAND_PRICES['/holders']} PFT)
/profile <address> — Wallet profile, instant if analyzed (${COMMAND_PRICES['/profile']} PFT)
/analyze <address> — Force fresh deep analysis (${COMMAND_PRICES['/analyze']} PFT)
/compare <a1> <a2> — Compare wallets (${COMMAND_PRICES['/compare']} PFT)

Send a command with the required PFT amount to get results.`;

export type Config = typeof config;
