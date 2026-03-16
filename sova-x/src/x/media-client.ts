import { fetchWithRetry } from './http';

export interface UploadedMedia {
  mediaId: string;
}

export interface MediaClient {
  uploadPng(_input: Buffer): Promise<UploadedMedia>;
}

type MediaInitResponse = {
  data?: {
    id: string;
    expires_after_secs?: number;
    media_key?: string;
    processing_info?: {
      state?: string;
      check_after_secs?: number;
      progress_percent?: number;
    };
    size?: number;
  };
};

type MediaAppendResponse = {
  data?: {
    expires_at?: number;
  };
};

export class XMediaClient implements MediaClient {
  constructor(
    private readonly baseUrl: string,
    private readonly auth:
      | { kind: 'bearer'; token: string }
      | { kind: 'oauth1'; credentials: import('./oauth1').OAuth1Credentials },
  ) {}

  async uploadPng(input: Buffer): Promise<UploadedMedia> {
    const mediaId = await this.initializeUpload(input.length);
    await this.appendUpload(mediaId, input);
    await this.finalizeUpload(mediaId);
    return { mediaId };
  }

  private async initializeUpload(totalBytes: number): Promise<string> {
    const url = `${this.baseUrl}/media/upload/initialize`;
    const body = {
      media_type: 'image/png',
      media_category: 'tweet_image',
      total_bytes: totalBytes,
    };

    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: this.buildHeaders(url, 'POST', body, true),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`X media initialize failed (${response.status}): ${await response.text()}`);
    }

    const payload = (await response.json()) as MediaInitResponse;
    const mediaId = payload.data?.id;
    if (!mediaId) {
      throw new Error('X media initialize did not return a media id.');
    }
    return mediaId;
  }

  private async appendUpload(mediaId: string, input: Buffer): Promise<void> {
    const form = new FormData();
    form.set('segment_index', '0');
    form.set('media', new Blob([input], { type: 'image/png' }), 'holder-distribution.png');

    const url = `${this.baseUrl}/media/upload/${mediaId}/append`;
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: this.buildHeaders(url, 'POST'),
      body: form,
    });

    if (!response.ok) {
      throw new Error(`X media append failed (${response.status}): ${await response.text()}`);
    }

    await response.json() as Promise<MediaAppendResponse>;
  }

  private async finalizeUpload(mediaId: string): Promise<void> {
    const url = `${this.baseUrl}/media/upload/${mediaId}/finalize`;
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: this.buildHeaders(url, 'POST'),
    });

    if (!response.ok) {
      throw new Error(`X media finalize failed (${response.status}): ${await response.text()}`);
    }

    const payload = (await response.json()) as MediaInitResponse;
    const state = payload.data?.processing_info?.state;
    if (state && state !== 'succeeded') {
      throw new Error(`X media finalize returned processing state '${state}'. Polling is not implemented yet.`);
    }
  }

  private buildHeaders(
    url: string,
    method: 'POST',
    body?: Record<string, unknown>,
    isJson = false,
  ): Record<string, string> {
    if (this.auth.kind === 'bearer') {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.auth.token}`,
      };
      if (isJson) {
        headers['Content-Type'] = 'application/json';
      }
      return headers;
    }

    const { buildOAuth1Header } = require('./oauth1') as typeof import('./oauth1');
    const headers: Record<string, string> = {
      Authorization: buildOAuth1Header({
        url,
        method,
        credentials: this.auth.credentials,
      }),
    };
    if (isJson) {
      headers['Content-Type'] = 'application/json';
    }
    return headers;
  }
}
