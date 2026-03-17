import { Injectable, Logger } from '@nestjs/common';
import { HeliusApiClient } from './helius-api-client';
import type { HeliusWalletIdentity } from '@/types/helius-api';
import type { KnownWalletType, KnownWalletEntry } from '../../config/known-wallets';

/**
 * HeliusIdentityResolver
 *
 * Stateless translation layer between the Helius Wallet Identity API
 * (5,100+ tagged accounts, 1,900+ programs) and our KnownWalletEntry format.
 *
 * This service does NOT cache positive results in memory — that's the job of
 * the existing persistence stack (SystemWalletDetectionService -> DB/Redis/memory).
 * Once an identity is resolved, the caller persists it and subsequent lookups
 * never reach this resolver again.
 *
 * The only in-memory state is a negative cache (addresses Helius doesn't recognize)
 * to avoid hammering the API with repeated 404s for random trader wallets.
 * These are TTL'd at 24h because Helius continuously adds new entries.
 */
@Injectable()
export class HeliusIdentityResolver {
  private readonly logger = new Logger(HeliusIdentityResolver.name);

  /** Addresses Helius doesn't recognize. Re-checked after 24h in case Helius added them. */
  private readonly unknownAddresses = new Map<string, number>(); // address -> expiresAt
  private static readonly NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000;
  private static readonly UNKNOWN_CACHE_MAX = 100_000;

  constructor(private readonly heliusClient: HeliusApiClient) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Resolve a batch of addresses. Returns only recognized addresses.
   * Callers are responsible for persisting results (DB/Redis) so this
   * method is not called again for the same addresses.
   */
  async resolveBatch(addresses: string[]): Promise<Map<string, KnownWalletEntry>> {
    const results = new Map<string, KnownWalletEntry>();
    if (!addresses.length) return results;

    const now = Date.now();
    const toQuery = addresses.filter(addr => {
      const expiry = this.unknownAddresses.get(addr);
      if (expiry !== undefined) {
        if (expiry > now) return false;
        this.unknownAddresses.delete(addr);
      }
      return true;
    });

    if (!toQuery.length) return results;

    const identities = await this.heliusClient.batchGetWalletIdentities(toQuery);

    const recognized = new Set<string>();
    for (const [address, identity] of identities) {
      const entry = this.mapToKnownEntry(identity);
      if (entry) {
        results.set(address, entry);
        recognized.add(address);
      }
    }

    for (const addr of toQuery) {
      if (!recognized.has(addr)) {
        this.cacheUnknown(addr);
      }
    }

    if (results.size > 0) {
      this.logger.debug(`Helius identity resolved ${results.size}/${toQuery.length} addresses`);
    }

    return results;
  }

  /**
   * Resolve a single address. Returns null if unrecognized.
   */
  async resolve(address: string): Promise<KnownWalletEntry | null> {
    const expiry = this.unknownAddresses.get(address);
    if (expiry !== undefined && expiry > Date.now()) return null;

    const identity = await this.heliusClient.getWalletIdentity(address);
    if (!identity) {
      this.cacheUnknown(address);
      return null;
    }

    return this.mapToKnownEntry(identity);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Identity -> KnownWalletEntry mapping
  // ═══════════════════════════════════════════════════════════════════════════

  private mapToKnownEntry(identity: HeliusWalletIdentity): KnownWalletEntry | null {
    const type = this.inferType(identity);
    if (!type) return null;

    return {
      type,
      label: identity.name,
      shortLabel: this.deriveShortLabel(identity),
    };
  }

  /**
   * Map Helius identity type/category/tags into our KnownWalletType.
   * Returns null for types we can't confidently map — the wallet
   * falls through to on-chain heuristics instead of being misclassified.
   */
  private inferType(identity: HeliusWalletIdentity): KnownWalletType | null {
    const t = identity.type?.toLowerCase() ?? '';
    const c = identity.category?.toLowerCase() ?? '';
    const tags = (identity.tags ?? []).map(tag => tag.toLowerCase());

    if (
      t === 'exchange' ||
      c.includes('exchange') ||
      tags.some(tag => tag.includes('exchange'))
    ) {
      return 'EXCHANGE';
    }

    if (
      t === 'protocol' ||
      t === 'program' ||
      c.includes('defi') ||
      c.includes('amm') ||
      c.includes('lending') ||
      c.includes('dex') ||
      tags.some(tag => tag.includes('defi') || tag.includes('amm') || tag.includes('protocol'))
    ) {
      return 'PROTOCOL';
    }

    if (tags.some(tag => tag.includes('liquidity') || tag.includes('pool') || tag.includes('vault'))) {
      return 'LP';
    }

    if (
      t === 'institution' ||
      c.includes('market maker') ||
      c.includes('infrastructure') ||
      tags.some(tag => tag.includes('institution') || tag.includes('market maker'))
    ) {
      return 'SYSTEM';
    }

    this.logger.debug(`Unmapped Helius identity: type="${identity.type}" category="${identity.category}" tags=${JSON.stringify(identity.tags)}`);
    return null;
  }

  private deriveShortLabel(identity: HeliusWalletIdentity): string {
    const name = identity.name ?? identity.category ?? identity.type ?? 'Unknown';
    const firstWord = name.split(/[\s\-_:]+/)[0];
    return firstWord || name;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Negative cache
  // ═══════════════════════════════════════════════════════════════════════════

  private cacheUnknown(address: string): void {
    while (this.unknownAddresses.size >= HeliusIdentityResolver.UNKNOWN_CACHE_MAX) {
      const oldest = this.unknownAddresses.keys().next().value;
      if (!oldest) break;
      this.unknownAddresses.delete(oldest);
    }
    this.unknownAddresses.set(address, Date.now() + HeliusIdentityResolver.NEGATIVE_TTL_MS);
  }

  getStats(): { unknownCacheSize: number } {
    return { unknownCacheSize: this.unknownAddresses.size };
  }
}
