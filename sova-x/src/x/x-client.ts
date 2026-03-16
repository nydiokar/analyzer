import type { XCreatePostRequest, XCreatePostResponse, XMention, XTweet } from '../types/x';

type HttpMethod = 'GET' | 'POST';

export class XClient {
  constructor(
    private readonly baseUrl: string,
    private readonly bearerToken: string,
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
    const response = await fetch(`${this.baseUrl}${pathname}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.bearerToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`X API request failed (${response.status}): ${await response.text()}`);
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
