export type ParsedXPostUrl = {
  sourceUrl: string;
  normalizedUrl: string;
  tweetId: string;
  username: string | null;
};

const STATUS_PATH_REGEX: RegExp = /^\/([^/]+)\/status\/(\d+)(?:\/.*)?$/;

export function parseXPostUrl(input: string): ParsedXPostUrl | null {
  const trimmed: string = input.trim();
  if (!trimmed) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const hostname: string = url.hostname.toLowerCase();
  if (hostname !== 'x.com' && hostname !== 'www.x.com' && hostname !== 'twitter.com' && hostname !== 'www.twitter.com') {
    return null;
  }

  const match = url.pathname.match(STATUS_PATH_REGEX);
  if (!match) {
    return null;
  }

  const username: string = match[1];
  const tweetId: string = match[2];
  return {
    sourceUrl: trimmed,
    normalizedUrl: `https://x.com/${username}/status/${tweetId}`,
    tweetId,
    username,
  };
}
