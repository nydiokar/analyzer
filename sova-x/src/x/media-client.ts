export interface UploadedMedia {
  mediaId: string;
}

export interface MediaClient {
  uploadPng(_input: Buffer): Promise<UploadedMedia>;
}

export class NotImplementedMediaClient implements MediaClient {
  async uploadPng(_input: Buffer): Promise<UploadedMedia> {
    throw new Error(
      'PNG upload is not implemented in the scaffold yet. Validate render locally first, then wire the current X media upload flow from docs.x.com.',
    );
  }
}
