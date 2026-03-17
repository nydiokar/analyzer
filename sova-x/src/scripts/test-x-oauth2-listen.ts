import http from 'node:http';
import { loadEnv } from '../config/env';
import { completeOAuth2FromCallbackUrl } from './oauth2-complete';

async function main(): Promise<void> {
  const env = loadEnv();
  const redirectUrl = new URL(env.xOAuth2RedirectUri);

  if (!redirectUrl.hostname || !redirectUrl.port) {
    throw new Error(`X_OAUTH2_REDIRECT_URI must include a host and port. Received: ${env.xOAuth2RedirectUri}`);
  }

  const server = http.createServer((req, res) => {
    void handleRequest(req.url ?? '/', redirectUrl, res, server);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(redirectUrl.port), redirectUrl.hostname, () => {
      server.off('error', reject);
      resolve();
    });
  });

  console.log(`Listening for OAuth callback on ${env.xOAuth2RedirectUri}`);
  console.log('Keep this process running, then complete the X app authorization in your browser.');
}

async function handleRequest(
  requestUrl: string,
  redirectUrl: URL,
  res: http.ServerResponse,
  server: http.Server,
): Promise<void> {
  const callbackUrl = new URL(requestUrl, redirectUrl.origin);

  if (callbackUrl.pathname !== redirectUrl.pathname) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found.');
    return;
  }

  try {
    await completeOAuth2FromCallbackUrl(callbackUrl.toString());
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(buildHtml('X OAuth completed', 'Authorization succeeded. You can close this tab and return to the terminal.'));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(buildHtml('X OAuth failed', `Authorization failed: ${escapeHtml(message)}`));
    console.error(error);
  } finally {
    server.close();
  }
}

function buildHtml(title: string, message: string): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${title}</title>`,
    '</head>',
    '<body style="font-family:Segoe UI,Arial,sans-serif;padding:32px;background:#111;color:#f5f5f5;">',
    `<h1>${title}</h1>`,
    `<p>${message}</p>`,
    '</body>',
    '</html>',
  ].join('');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
