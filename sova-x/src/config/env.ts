import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();
disableBrokenProxyEnv();

export type SovaXEnv = {
  sovaIntelBaseUrl: string;
  sovaIntelApiKey: string | null;
  xApiBaseUrl: string;
  xBotUsername: string;
  xBotUserId: string | null;
  xBearerToken: string | null;
  xConsumerKey: string | null;
  xConsumerSecret: string | null;
  xAccessToken: string | null;
  xAccessTokenSecret: string | null;
  xClientId: string | null;
  xClientSecret: string | null;
  xOAuth2RedirectUri: string;
  xOAuth2AccessToken: string | null;
  xOAuth2RefreshToken: string | null;
  xAllowedCallerIds: string[];
  pollIntervalMs: number;
  defaultTopN: number;
  outputDir: string;
};

function parseInteger(name: string, fallback: number): number {
  const raw: string | undefined = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed: number = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid integer for ${name}: ${raw}`);
  }

  return parsed;
}

function parseCsv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function loadEnv(): SovaXEnv {
  return {
    sovaIntelBaseUrl: process.env.SOVA_INTEL_BASE_URL ?? 'http://localhost:3001/api/v1',
    sovaIntelApiKey: process.env.SOVA_INTEL_API_KEY ?? null,
    xApiBaseUrl: process.env.X_API_BASE_URL ?? 'https://api.x.com/2',
    xBotUsername: process.env.X_BOT_USERNAME ?? 'sova_intel',
    xBotUserId: process.env.X_BOT_USER_ID ?? null,
    xBearerToken: process.env.X_BEARER_TOKEN ?? null,
    xConsumerKey: process.env.X_CONSUMER_KEY ?? null,
    xConsumerSecret: process.env.X_CONSUMER_SECRET ?? null,
    xAccessToken: process.env.X_ACCESS_TOKEN ?? null,
    xAccessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET ?? null,
    xClientId: process.env.X_CLIENT_ID ?? null,
    xClientSecret: process.env.X_CLIENT_SECRET ?? null,
    xOAuth2RedirectUri: process.env.X_OAUTH2_REDIRECT_URI ?? 'http://127.0.0.1:8765/callback',
    xOAuth2AccessToken: process.env.X_OAUTH2_ACCESS_TOKEN ?? null,
    xOAuth2RefreshToken: process.env.X_OAUTH2_REFRESH_TOKEN ?? null,
    xAllowedCallerIds: parseCsv(process.env.X_ALLOWED_CALLER_IDS),
    pollIntervalMs: parseInteger('SOVA_X_POLL_INTERVAL_MS', 5000),
    defaultTopN: parseInteger('SOVA_X_TOP_N', 20),
    outputDir: path.resolve(process.cwd(), process.env.SOVA_X_OUTPUT_DIR ?? './out'),
  };
}

function disableBrokenProxyEnv(): void {
  const proxyKeys = [
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
    'http_proxy',
    'https_proxy',
    'all_proxy',
  ] as const;

  for (const key of proxyKeys) {
    const value = process.env[key];
    if (!value) {
      continue;
    }

    if (value.includes('127.0.0.1:9') || value.includes('localhost:9')) {
      delete process.env[key];
    }
  }
}
