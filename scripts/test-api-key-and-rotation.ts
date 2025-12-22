import axios, { AxiosInstance } from 'axios';
import * as process from 'process';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ApiKeyService } from '../src/api/shared/services/api-key.service';
import { JwtKeyRotationService } from '../src/api/shared/services/jwt-key-rotation.service';

type AuthResponse = {
  access_token: string;
  refresh_token: string;
  user: { id: string; email: string; isDemo: boolean; emailVerified: boolean };
};

async function maybeGetCsrf(baseUrl: string, client: AxiosInstance, useCookieMode: boolean): Promise<string | null> {
  if (!useCookieMode) return null;
  const { data } = await client.get<{ csrfToken?: string }>(`${baseUrl}/auth/csrf-token`);
  return data.csrfToken ?? null;
}

function decodeJwtHeader(token: string): any {
  const headerPart = token.split('.')[0];
  const json = Buffer.from(headerPart, 'base64url').toString();
  return JSON.parse(json);
}

async function run() {
  // Prevent workers during programmatic bootstrap
  process.env.DISABLE_WORKERS = process.env.DISABLE_WORKERS || 'true';

  const port = process.env.PORT || '3001';
  const baseUrl = `http://localhost:${port}/api/v1`;
  const cookieMode = (process.env.AUTH_COOKIE_MODE || 'false') === 'true';
  console.log(`Testing API key auth and JWT rotation at ${baseUrl}`);

  const client = axios.create({ baseURL: baseUrl, validateStatus: () => true });

  // 1) Register user (with CSRF if cookie mode)
  const email = `apit_${Date.now()}@example.test`;
  const password = 'StrongPassw0rd';
  const csrf1 = await maybeGetCsrf(baseUrl, client, cookieMode);
  const regRes = await client.post<AuthResponse>(
    '/auth/register',
    { email, password },
    { headers: csrf1 ? { 'X-CSRF-Token': csrf1 } : undefined }
  );
  if (regRes.status !== 201 && regRes.status !== 200) {
    throw new Error(`Register failed: ${regRes.status}`);
  }
  const reg = regRes.data;

  // 2) Programmatically create API key for this user
  const app = await NestFactory.create(AppModule, { logger: false });
  const apiKeyService = app.get(ApiKeyService);
  const createKey = await apiKeyService.createApiKey({
    userId: reg.user.id,
    description: 'test key',
    scopes: ['read'],
  });
  const apiKey = createKey.apiKey; // full key (prefix_secret)

  // 3) Call an authenticated endpoint using X-API-Key
  const health = await client.get('/security/health', {
    headers: { 'x-api-key': apiKey },
  });
  if (health.status !== 200) {
    throw new Error(`API key auth failed: ${health.status}`);
  }

  // 4) Capture current access token kid
  const kidBefore = decodeJwtHeader(reg.access_token).kid;

  // 5) Rotate JWT key
  const rotation = app.get(JwtKeyRotationService);
  const newKey = rotation.rotateKey();

  // 6) Login again to get a token signed with new kid
  const csrf2 = await maybeGetCsrf(baseUrl, client, cookieMode);
  const loginRes = await client.post<AuthResponse>(
    '/auth/login',
    { email, password },
    { headers: csrf2 ? { 'X-CSRF-Token': csrf2 } : undefined }
  );
  if (loginRes.status !== 200) {
    throw new Error(`Login after rotation failed: ${loginRes.status}`);
  }
  const tokens2 = loginRes.data;
  const kidAfter = decodeJwtHeader(tokens2.access_token).kid;

  if (kidBefore === kidAfter) {
    throw new Error(`Expected new kid after rotation, got same kid: ${kidAfter}`);
  }

  // 7) Verify both old and new tokens still work (old key remains active)
  const meOld = await client.get('/auth/me', { headers: { Authorization: `Bearer ${reg.access_token}` } });
  if (meOld.status !== 200) throw new Error(`Old token failed after rotation: ${meOld.status}`);

  const meNew = await client.get('/auth/me', { headers: { Authorization: `Bearer ${tokens2.access_token}` } });
  if (meNew.status !== 200) throw new Error(`New token failed after rotation: ${meNew.status}`);

  await app.close();
  console.log('API key auth and key rotation tests passed.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});


