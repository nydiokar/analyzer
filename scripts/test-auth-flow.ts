import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';
import * as process from 'process';

type AuthResponse = {
  access_token: string;
  refresh_token: string;
  user: { id: string; email: string; isDemo: boolean; emailVerified: boolean };
};

function randomEmail(): string {
  const id = crypto.randomBytes(6).toString('hex');
  return `user_${id}@example.test`;
}

async function maybeGetCsrf(baseUrl: string, client: AxiosInstance, useCookieMode: boolean): Promise<string | null> {
  if (!useCookieMode) return null;
  const { data } = await client.get<{ csrfToken?: string }>(`${baseUrl}/auth/csrf-token`);
  return data.csrfToken ?? null;
}

async function run() {
  const port = process.env.PORT || '3001';
  const baseUrl = `http://localhost:${port}/api/v1`;
  const cookieMode = (process.env.AUTH_COOKIE_MODE || 'false') === 'true';

  const client = axios.create({
    baseURL: baseUrl,
    validateStatus: () => true,
  });

  console.log(`Testing against ${baseUrl} (cookieMode=${cookieMode})`);

  // 1) Register
  const email = randomEmail();
  const password = 'StrongPassw0rd';
  const csrf1 = await maybeGetCsrf(baseUrl, client, cookieMode);
  const regRes = await client.post<AuthResponse>(
    '/auth/register',
    { email, password },
    { headers: csrf1 ? { 'X-CSRF-Token': csrf1 } : undefined }
  );
  if (regRes.status !== 201 && regRes.status !== 200) {
    throw new Error(`Register failed: ${regRes.status} ${JSON.stringify(regRes.data)}`);
  }
  const reg = regRes.data;
  console.log('Registered user:', reg.user.id, reg.user.email);

  // 2) Me with access token
  const meRes = await client.get('/auth/me', {
    headers: { Authorization: `Bearer ${reg.access_token}` },
  });
  if (meRes.status !== 200) throw new Error(`Me failed: ${meRes.status}`);
  console.log('Me OK');

  // 3) Login with wrong password should 401
  const csrf2 = await maybeGetCsrf(baseUrl, client, cookieMode);
  const badLogin = await client.post('/auth/login', { email, password: 'wrong' }, { headers: csrf2 ? { 'X-CSRF-Token': csrf2 } : undefined });
  if (badLogin.status !== 401) throw new Error(`Bad login expected 401, got ${badLogin.status}`);
  console.log('Bad login 401 OK');

  // 4) Login success
  const csrf3 = await maybeGetCsrf(baseUrl, client, cookieMode);
  const goodLogin = await client.post<AuthResponse>('/auth/login', { email, password }, { headers: csrf3 ? { 'X-CSRF-Token': csrf3 } : undefined });
  if (goodLogin.status !== 200) throw new Error(`Good login failed: ${goodLogin.status}`);
  const tokens1 = goodLogin.data;
  console.log('Login OK');

  // 5) Refresh -> new tokens
  const csrf4 = await maybeGetCsrf(baseUrl, client, cookieMode);
  const refresh1 = await client.post<AuthResponse>(
    '/auth/refresh',
    { refresh_token: tokens1.refresh_token },
    { headers: csrf4 ? { 'X-CSRF-Token': csrf4 } : undefined }
  );
  if (refresh1.status !== 200) throw new Error(`Refresh failed: ${refresh1.status}`);
  const tokens2 = refresh1.data;
  console.log('Refresh OK, rotated refresh token');

  // 6) Old refresh token should be invalid now
  const csrf5 = await maybeGetCsrf(baseUrl, client, cookieMode);
  const shouldFail = await client.post(
    '/auth/refresh',
    { refresh_token: tokens1.refresh_token },
    { headers: csrf5 ? { 'X-CSRF-Token': csrf5 } : undefined }
  );
  if (shouldFail.status !== 401) throw new Error(`Old refresh reuse expected 401, got ${shouldFail.status}`);
  console.log('Old refresh reuse 401 OK (replay blocked, sessions revoked)');

  // 7) Replay should revoke chain: even the latest refresh should now fail
  const csrf5b = await maybeGetCsrf(baseUrl, client, cookieMode);
  const replayChainFail = await client.post(
    '/auth/refresh',
    { refresh_token: tokens2.refresh_token },
    { headers: csrf5b ? { 'X-CSRF-Token': csrf5b } : undefined }
  );
  if (replayChainFail.status !== 401) throw new Error(`Replay chain expected 401, got ${replayChainFail.status}`);
  console.log('Replay chain revoke OK');

  // 8) Login again after replay cleanup
  const csrf6 = await maybeGetCsrf(baseUrl, client, cookieMode);
  const loginAfterReplay = await client.post<AuthResponse>('/auth/login', { email, password }, { headers: csrf6 ? { 'X-CSRF-Token': csrf6 } : undefined });
  if (loginAfterReplay.status !== 200) throw new Error(`Login after replay cleanup failed: ${loginAfterReplay.status}`);
  const tokens3 = loginAfterReplay.data;
  console.log('Login after replay OK');

  // 9) Authenticated request with fresh access
  const meRes2 = await client.get('/auth/me', {
    headers: { Authorization: `Bearer ${tokens3.access_token}` },
  });
  if (meRes2.status !== 200) throw new Error(`Me with new access failed: ${meRes2.status}`);
  console.log('Me with new access OK');

  // 10) Fake refresh token should 401
  const csrf10 = await maybeGetCsrf(baseUrl, client, cookieMode);
  const fakeRefresh = await client.post(
    '/auth/refresh',
    { refresh_token: 'not-a-real-refresh-token' },
    { headers: csrf10 ? { 'X-CSRF-Token': csrf10 } : undefined }
  );
  if (fakeRefresh.status !== 401) throw new Error(`Fake refresh expected 401, got ${fakeRefresh.status}`);
  console.log('Fake refresh 401 OK');

  // 11) Tampered access token should 401
  const parts = tokens3.access_token.split('.');
  const tampered = parts.length === 3 ? [parts[0], parts[1] + 'x', parts[2]].join('.') : tokens3.access_token + 'x';
  const tamperedRes = await client.get('/auth/me', {
    headers: { Authorization: `Bearer ${tampered}` },
  });
  if (tamperedRes.status !== 401) throw new Error(`Tampered access token expected 401, got ${tamperedRes.status}`);
  console.log('Tampered access token 401 OK');

  // 12) Logout with current refresh
  const csrf7 = await maybeGetCsrf(baseUrl, client, cookieMode);
  const logout = await client.post(
    '/auth/logout',
    { refresh_token: tokens3.refresh_token },
    { headers: csrf7 ? { 'X-CSRF-Token': csrf7 } : undefined }
  );
  if (logout.status !== 200) throw new Error(`Logout failed: ${logout.status}`);
  console.log('Logout OK');

  // 13) Refresh after logout should fail
  const csrf8 = await maybeGetCsrf(baseUrl, client, cookieMode);
  const refreshAfterLogout = await client.post(
    '/auth/refresh',
    { refresh_token: tokens3.refresh_token },
    { headers: csrf8 ? { 'X-CSRF-Token': csrf8 } : undefined }
  );
  if (refreshAfterLogout.status !== 401) throw new Error(`Refresh after logout expected 401, got ${refreshAfterLogout.status}`);
  console.log('Refresh after logout 401 OK');

  // 14) Forgot password flow returns generic message
  const csrf9 = await maybeGetCsrf(baseUrl, client, cookieMode);
  const forgot = await client.post<{ message: string }>(
    '/auth/forgot-password',
    { email },
    { headers: csrf9 ? { 'X-CSRF-Token': csrf9 } : undefined }
  );
  if (forgot.status !== 200) throw new Error(`Forgot password failed: ${forgot.status}`);
  if (!forgot.data?.message) throw new Error('Forgot password missing message');
  console.log('Forgot password generic response OK');

  // 15) CSRF negative test (cookie mode only)
  if (cookieMode) {
    const noCsrf = await client.post('/auth/login', { email, password });
    if (noCsrf.status !== 403) throw new Error(`Missing CSRF expected 403, got ${noCsrf.status}`);
    console.log('Missing CSRF 403 OK');
  }

  console.log('All tests passed.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
