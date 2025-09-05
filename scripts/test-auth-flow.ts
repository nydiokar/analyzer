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
  console.log('Old refresh reuse 401 OK');

  // 7) Authenticated request with new access
  const meRes2 = await client.get('/auth/me', {
    headers: { Authorization: `Bearer ${tokens2.access_token}` },
  });
  if (meRes2.status !== 200) throw new Error(`Me with new access failed: ${meRes2.status}`);
  console.log('Me with new access OK');

  // 8) Logout with current refresh
  const csrf6 = await maybeGetCsrf(baseUrl, client, cookieMode);
  const logout = await client.post(
    '/auth/logout',
    { refresh_token: tokens2.refresh_token },
    { headers: csrf6 ? { 'X-CSRF-Token': csrf6 } : undefined }
  );
  if (logout.status !== 200) throw new Error(`Logout failed: ${logout.status}`);
  console.log('Logout OK');

  // 9) Refresh after logout should fail
  const csrf7 = await maybeGetCsrf(baseUrl, client, cookieMode);
  const refreshAfterLogout = await client.post(
    '/auth/refresh',
    { refresh_token: tokens2.refresh_token },
    { headers: csrf7 ? { 'X-CSRF-Token': csrf7 } : undefined }
  );
  if (refreshAfterLogout.status !== 401) throw new Error(`Refresh after logout expected 401, got ${refreshAfterLogout.status}`);
  console.log('Refresh after logout 401 OK');

  // 10) CSRF negative test (cookie mode only)
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


