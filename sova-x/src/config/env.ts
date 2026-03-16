import path from 'node:path';

export type SovaXEnv = {
  sovaIntelBaseUrl: string;
  sovaIntelApiKey: string | null;
  xApiBaseUrl: string;
  xBotUsername: string;
  xBotUserId: string | null;
  xBearerToken: string | null;
  xAccessToken: string | null;
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
    xAccessToken: process.env.X_ACCESS_TOKEN ?? null,
    xAllowedCallerIds: parseCsv(process.env.X_ALLOWED_CALLER_IDS),
    pollIntervalMs: parseInteger('SOVA_X_POLL_INTERVAL_MS', 5000),
    defaultTopN: parseInteger('SOVA_X_TOP_N', 20),
    outputDir: path.resolve(process.cwd(), process.env.SOVA_X_OUTPUT_DIR ?? './out'),
  };
}
