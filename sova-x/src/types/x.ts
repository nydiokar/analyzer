export type XReferencedTweet = {
  type: 'replied_to' | 'quoted' | 'retweeted';
  id: string;
};

export type XTweet = {
  id: string;
  text: string;
  authorId: string;
  authorUsername: string | null;
  conversationId: string;
  referencedTweets: XReferencedTweet[];
};

export type XMention = XTweet;

export type XCreatePostRequest = {
  text: string;
  replyToTweetId?: string;
  mediaIds?: string[];
};

export type XCreatePostResponse = {
  id: string;
  text: string;
};
