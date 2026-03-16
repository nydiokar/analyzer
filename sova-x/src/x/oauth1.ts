import crypto from 'node:crypto';
import OAuth from 'oauth-1.0a';

export type OAuth1Credentials = {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
};

export function buildOAuth1Header(params: {
  url: string;
  method: 'GET' | 'POST';
  credentials: OAuth1Credentials;
}): string {
  const oauth = new OAuth({
    consumer: {
      key: params.credentials.consumerKey,
      secret: params.credentials.consumerSecret,
    },
    signature_method: 'HMAC-SHA1',
    hash_function(baseString, key) {
      return crypto
        .createHmac('sha1', key)
        .update(baseString)
        .digest('base64');
    },
  });

  const auth = oauth.authorize(
    {
      url: params.url,
      method: params.method,
    },
    {
      key: params.credentials.accessToken,
      secret: params.credentials.accessTokenSecret,
    },
  );

  return oauth.toHeader(auth).Authorization;
}
