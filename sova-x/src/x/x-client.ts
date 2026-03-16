import type { XCreatePostRequest, XCreatePostResponse, XMention, XTweet } from '../types/x';
import { buildOAuth1Header, type OAuth1Credentials } from './oauth1';
import { fetchWithRetry } from './http';

type HttpMethod = 'GET' | 'POST';

export class XClient {
  constructor(
    private readonly baseUrl: string,
    private readonly auth:
      | { kind: 'bearer'; token: string }
      | { kind: 'oauth1'; credentials: OAuth1Credentials },
  ) {}

  async getMentions(userId: string, sinceId?: string): Promise<XMention[]> {
    const query: string = sinceId ? `?since_id=${encodeURIComponent(sinceId)}` : '';
    const response = await this.request<{ data?: unknown[] }>('GET', `/users/${userId}/mentions${query}`);
    const rows: unknown[] = response.data ?? [];
    return rows.map(mapTweet);
  }

  async getTweet(tweetId: string): Promise<XTweet> {
    const response = await this.request<{ data: unknown }>('GET', `/tweets/${tweetId}`);
    return mapTweet(response.data);
  }

  async getAuthenticatedUser(): Promise<{ id: string; username?: string; name?: string }> {
    const response = await this.request<{ data: { id: string; username?: string; name?: string } }>(
      'GET',
      '/users/me',
    );
    return response.data;
  }

  async createPost(input: XCreatePostRequest): Promise<XCreatePostResponse> {
    const body: Record<string, unknown> = {
      text: input.text,
    };

    if (input.replyToTweetId) {
      body.reply = { in_reply_to_tweet_id: input.replyToTweetId };
    }

    if (input.mediaIds && input.mediaIds.length > 0) {
      body.media = { media_ids: input.mediaIds };
    }

    const response = await this.request<{ data: { id: string; text: string } }>('POST', '/tweets', body);
    return {
      id: response.data.id,
      text: response.data.text,
    };
  }

  private async request<T>(method: HttpMethod, pathname: string, body?: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}${pathname}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.auth.kind === 'bearer') {
      headers.Authorization = `Bearer ${this.auth.token}`;
    } else {
      headers.Authorization = buildOAuth1Header({
        url,
        method,
        credentials: this.auth.credentials,
      });
    }

    const response = await fetchWithRetry(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const responseText = await response.text();
      const headerDump = Array.from(response.headers.entries())
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n');
      throw new Error(
        `X API request failed (${response.status}) ${method} ${pathname}\n` +
        `Headers:\n${headerDump}\n` +
        `Body:\n${responseText}`,
      );
    }

    return response.json() as Promise<T>;
  }
}

function mapTweet(raw: unknown): XTweet {
  const row = raw as {
    id: string;
    text: string;
    author_id?: string;
    conversation_id?: string;
    referenced_tweets?: Array<{ type: 'replied_to' | 'quoted' | 'retweeted'; id: string }>;
  };

  return {
    id: row.id,
    text: row.text,
    authorId: row.author_id ?? '',
    conversationId: row.conversation_id ?? row.id,
    referencedTweets: row.referenced_tweets ?? [],
  };
}
