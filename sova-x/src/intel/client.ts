import type { HolderProfilesResult } from '../types/holder-profiles';

export interface IntelClient {
  pollHolderProfiles(mint: string, topN: number): Promise<HolderProfilesResult>;
}

export class StubIntelClient implements IntelClient {
  constructor(private readonly fixture: HolderProfilesResult) {}

  async pollHolderProfiles(_mint: string, _topN: number): Promise<HolderProfilesResult> {
    return this.fixture;
  }
}
