import crypto from 'node:crypto';

export type PkceSession = {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  createdAtIso: string;
};

export type OAuth2TokenResponse = {
  token_type: string;
  expires_in: number;
  access_token: string;
  scope?: string;
  refresh_token?: string;
};

export function createPkceSession(): PkceSession {
  const codeVerifier = base64Url(crypto.randomBytes(48));
  const codeChallenge = base64Url(
    crypto.createHash('sha256').update(codeVerifier).digest(),
  );
  return {
    state: base64Url(crypto.randomBytes(24)),
    codeVerifier,
    codeChallenge,
    createdAtIso: new Date().toISOString(),
  };
}

export function buildAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes: string[];
}): string {
  const url = new URL('https://x.com/i/oauth2/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('scope', params.scopes.join(' '));
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export async function exchangeCodeForToken(params: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
  clientId: string;
  clientSecret?: string | null;
}): Promise<OAuth2TokenResponse> {
  const body = new URLSearchParams();
  body.set('code', params.code);
  body.set('grant_type', 'authorization_code');
  body.set('redirect_uri', params.redirectUri);
  body.set('code_verifier', params.codeVerifier);

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  if (params.clientSecret) {
    const basic = Buffer.from(`${params.clientId}:${params.clientSecret}`).toString('base64');
    headers.Authorization = `Basic ${basic}`;
  } else {
    body.set('client_id', params.clientId);
  }

  const response = await fetch('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers,
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`OAuth2 token exchange failed (${response.status}): ${await response.text()}`);
  }

  return response.json() as Promise<OAuth2TokenResponse>;
}

function base64Url(input: Buffer): string {
  return input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}
