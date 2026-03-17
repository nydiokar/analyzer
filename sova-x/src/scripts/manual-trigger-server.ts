import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { loadEnv } from '../config/env';
import { processTrigger } from '../app/process-trigger';
import { SdkIntelClient } from '../intel/client';
import { DexscreenerTokenMetadataClient } from '../metadata/client';
import { renderSvgToPngBuffer } from '../render/png';
import { XMediaClient } from '../x/media-client';
import { XClient } from '../x/x-client';

type TriggerResponse = {
  runId: string;
  status: 'previewed' | 'posted';
  tweetId: string;
  normalizedTweetUrl: string;
  mint: string;
  replyText: string;
  previewImageUrl: string;
  outputJsonPath: string;
  postedReplyId?: string;
};

type PreviewAsset = {
  png: Buffer;
};

const previewAssets: Map<string, PreviewAsset> = new Map();

async function main(): Promise<void> {
  const host: string = '127.0.0.1';
  const port: number = 8787;
  const server = http.createServer((req, res) => {
    void handleRequest(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  console.log(`Manual trigger UI listening at http://${host}:${port}`);
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const method: string = req.method ?? 'GET';
  const url: URL = new URL(req.url ?? '/', 'http://127.0.0.1:8787');

  if (method === 'GET' && url.pathname === '/') {
    respondHtml(res, renderIndexHtml());
    return;
  }

  if (method === 'GET' && url.pathname.startsWith('/preview/')) {
    const runId: string = path.basename(url.pathname, '.png');
    const asset = previewAssets.get(runId);
    if (!asset) {
      respondText(res, 404, 'Preview not found.');
      return;
    }

    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(asset.png);
    return;
  }

  if (method === 'POST' && url.pathname === '/api/trigger') {
    try {
      const body = await readJsonBody(req);
      const result = await runTrigger({
        tweetUrl: expectString(body.tweetUrl, 'tweetUrl'),
        mint: expectString(body.mint, 'mint'),
        mode: body.mode === 'post' ? 'post' : 'preview',
      });
      respondJson(res, 200, result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      respondJson(res, 400, { error: message });
    }
    return;
  }

  respondText(res, 404, 'Not found.');
}

async function runTrigger(params: {
  tweetUrl: string;
  mint: string;
  mode: 'preview' | 'post';
}): Promise<TriggerResponse> {
  const env = loadEnv();
  if (!env.sovaIntelApiKey) {
    throw new Error('SOVA_INTEL_API_KEY is required in sova-x/.env');
  }

  const intelClient = new SdkIntelClient({
    baseUrl: env.sovaIntelBaseUrl,
    apiKey: env.sovaIntelApiKey,
    pollIntervalMs: env.pollIntervalMs,
  });
  const metadataClient = new DexscreenerTokenMetadataClient();

  const triggerResult = await processTrigger({
    tweetUrl: params.tweetUrl,
    mint: params.mint,
    intelClient,
    metadataClient,
    topN: env.defaultTopN,
  });
  if (triggerResult.status !== 'ready') {
    throw new Error(triggerResult.reason);
  }

  const png: Buffer = await renderSvgToPngBuffer(triggerResult.socialCardSvg);
  const runId: string = randomUUID();
  previewAssets.set(runId, { png });
  const outputJsonPath: string = await writeRunArtifacts({
    outputDir: env.outputDir,
    runId,
    tweetId: triggerResult.tweetId,
    normalizedTweetUrl: triggerResult.normalizedTweetUrl,
    mint: triggerResult.mint,
    replyText: triggerResult.replyText,
  });

  let postedReplyId: string | undefined;
  if (params.mode === 'post') {
    postedReplyId = await postReply({
      env,
      replyText: triggerResult.replyText,
      replyToTweetId: triggerResult.tweetId,
      png,
    });
  }

  return {
    runId,
    status: params.mode === 'post' ? 'posted' : 'previewed',
    tweetId: triggerResult.tweetId,
    normalizedTweetUrl: triggerResult.normalizedTweetUrl,
    mint: triggerResult.mint,
    replyText: triggerResult.replyText,
    previewImageUrl: `/preview/${runId}.png`,
    outputJsonPath,
    postedReplyId,
  };
}

async function postReply(params: {
  env: ReturnType<typeof loadEnv>;
  replyText: string;
  replyToTweetId: string;
  png: Buffer;
}): Promise<string> {
  const auth = buildPostAuth(params.env);
  const xClient = new XClient(params.env.xApiBaseUrl, auth);
  const mediaClient = new XMediaClient(params.env.xApiBaseUrl, auth);
  const uploaded = await mediaClient.uploadPng(params.png);
  const post = await xClient.createPost({
    text: params.replyText,
    replyToTweetId: params.replyToTweetId,
    mediaIds: [uploaded.mediaId],
  });
  return post.id;
}

function buildPostAuth(env: ReturnType<typeof loadEnv>):
  | { kind: 'bearer'; token: string }
  | {
      kind: 'oauth1';
      credentials: {
        consumerKey: string;
        consumerSecret: string;
        accessToken: string;
        accessTokenSecret: string;
      };
    } {
  if (env.xConsumerKey && env.xConsumerSecret && env.xAccessToken && env.xAccessTokenSecret) {
    return {
      kind: 'oauth1',
      credentials: {
        consumerKey: env.xConsumerKey,
        consumerSecret: env.xConsumerSecret,
        accessToken: env.xAccessToken,
        accessTokenSecret: env.xAccessTokenSecret,
      },
    };
  }

  if (env.xOAuth2AccessToken) {
    return { kind: 'bearer', token: env.xOAuth2AccessToken };
  }

  throw new Error('Posting requires X_OAUTH2_ACCESS_TOKEN or the OAuth 1.0a credential set in sova-x/.env');
}

async function writeRunArtifacts(params: {
  outputDir: string;
  runId: string;
  tweetId: string;
  normalizedTweetUrl: string;
  mint: string;
  replyText: string;
}): Promise<string> {
  await fs.mkdir(params.outputDir, { recursive: true });
  const jsonPath: string = path.join(params.outputDir, `manual-trigger-${params.runId}.json`);
  await fs.writeFile(jsonPath, JSON.stringify({
    runId: params.runId,
    tweetId: params.tweetId,
    normalizedTweetUrl: params.normalizedTweetUrl,
    mint: params.mint,
    replyText: params.replyText,
    generatedAtIso: new Date().toISOString(),
  }, null, 2), 'utf8');
  return jsonPath;
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const rawBody: string = Buffer.concat(chunks).toString('utf8');
  if (!rawBody) {
    return {};
  }

  return JSON.parse(rawBody) as Record<string, unknown>;
}

function expectString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} is required.`);
  }
  return value.trim();
}

function respondHtml(res: http.ServerResponse, html: string): void {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function respondText(res: http.ServerResponse, statusCode: number, text: string): void {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function respondJson(res: http.ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload, null, 2));
}

function renderIndexHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sova X Manual Trigger</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #08111d;
      --panel: #0d1727;
      --border: #1d2a40;
      --text: #f3f7ff;
      --muted: #92a7c7;
      --accent: #7bc86c;
      --accent-2: #8bbcff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", Arial, sans-serif;
      background:
        radial-gradient(circle at top left, rgba(139,188,255,0.18), transparent 28%),
        linear-gradient(180deg, #06101b 0%, #08111d 100%);
      color: var(--text);
    }
    main {
      max-width: 1040px;
      margin: 48px auto;
      padding: 0 20px;
    }
    .panel {
      background: rgba(13, 23, 39, 0.96);
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 24px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
    }
    h1 { margin: 0 0 8px; font-size: 32px; }
    p { margin: 0 0 20px; color: var(--muted); line-height: 1.5; }
    label { display: block; margin: 0 0 8px; font-weight: 600; }
    input, textarea, button {
      font: inherit;
    }
    input {
      width: 100%;
      padding: 14px 16px;
      border-radius: 14px;
      border: 1px solid var(--border);
      background: #08111d;
      color: var(--text);
      margin-bottom: 18px;
    }
    .actions {
      display: flex;
      gap: 12px;
      margin-top: 8px;
      margin-bottom: 20px;
    }
    button {
      border: 0;
      border-radius: 14px;
      padding: 12px 18px;
      cursor: pointer;
      color: #06101b;
      font-weight: 700;
    }
    button.preview { background: var(--accent-2); }
    button.post { background: var(--accent); }
    pre {
      white-space: pre-wrap;
      word-break: break-word;
      background: #08111d;
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 16px;
      color: var(--muted);
      min-height: 120px;
      overflow: auto;
    }
    img {
      display: block;
      width: 100%;
      margin-top: 20px;
      border-radius: 18px;
      border: 1px solid var(--border);
      background: #08111d;
    }
  </style>
</head>
<body>
  <main>
    <section class="panel">
      <h1>Sova X Manual Trigger</h1>
      <p>Paste a target X post URL and Solana mint. Preview first. Post only when the reply looks correct.</p>
      <label for="tweetUrl">Target X Post URL</label>
      <input id="tweetUrl" placeholder="https://x.com/user/status/1234567890123456789">
      <label for="mint">Token Mint</label>
      <input id="mint" placeholder="9xQeWvG816bUx9EPfEZkLqN2YtY1YfB9F9r3uL6kP7z">
      <div class="actions">
        <button class="preview" data-mode="preview">Preview Reply</button>
        <button class="post" data-mode="post">Post Reply</button>
      </div>
      <pre id="result">No run yet.</pre>
      <img id="preview" alt="Reply preview" hidden>
    </section>
  </main>
  <script>
    const resultEl = document.getElementById('result');
    const previewEl = document.getElementById('preview');
    const tweetUrlEl = document.getElementById('tweetUrl');
    const mintEl = document.getElementById('mint');

    async function run(mode) {
      resultEl.textContent = 'Running...';
      previewEl.hidden = true;
      previewEl.removeAttribute('src');

      const response = await fetch('/api/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tweetUrl: tweetUrlEl.value,
          mint: mintEl.value,
          mode,
        }),
      });

      const payload = await response.json();
      resultEl.textContent = JSON.stringify(payload, null, 2);

      if (response.ok && payload.previewImageUrl) {
        previewEl.src = payload.previewImageUrl + '?t=' + Date.now();
        previewEl.hidden = false;
      }
    }

    document.querySelectorAll('button[data-mode]').forEach((button) => {
      button.addEventListener('click', () => run(button.dataset.mode));
    });
  </script>
</body>
</html>`;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
