import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

export interface JwtKey {
  id: string;
  secret: string;
  algorithm: 'HS256' | 'RS256' | 'EdDSA';
  createdAt: Date;
  isActive: boolean;
}

@Injectable()
export class JwtKeyRotationService {
  private readonly logger = new Logger(JwtKeyRotationService.name);
  private readonly keys: Map<string, JwtKey> = new Map();
  private currentKeyId: string;

  constructor(private readonly configService: ConfigService) {
    this.initializeKeys();
  }

  /**
   * Initialize keys from configuration
   */
  private initializeKeys(): void {
    const primarySecret = this.configService.get<string>('JWT_SECRET');
    const primaryKeyId = this.configService.get<string>('JWT_PRIMARY_KEY_ID') || 'primary-key-v1';
    
    if (!primarySecret) {
      throw new Error('JWT_SECRET is required for key rotation service');
    }

    // Add primary key
    const primaryKey: JwtKey = {
      id: primaryKeyId,
      secret: primarySecret,
      algorithm: 'HS256',
      createdAt: new Date(),
      isActive: true,
    };

    this.keys.set(primaryKeyId, primaryKey);
    this.currentKeyId = primaryKeyId;

    // Load any additional keys from environment
    this.loadAdditionalKeys();

    this.logger.log(`JWT key rotation initialized with primary key: ${primaryKeyId}`);
  }

  /**
   * Load additional keys from environment variables
   * Format: JWT_KEY_<ID>=<secret>
   */
  private loadAdditionalKeys(): void {
    const envVars = Object.keys(process.env);
    const keyPattern = /^JWT_KEY_(.+)$/;

    for (const envVar of envVars) {
      const match = envVar.match(keyPattern);
      if (match && match[1] !== 'ROTATION_POLICY') {
        const keyId = match[1].toLowerCase();
        const secret = process.env[envVar];
        
        if (secret && keyId !== this.currentKeyId) {
          const key: JwtKey = {
            id: keyId,
            secret,
            algorithm: 'HS256',
            createdAt: new Date(),
            isActive: true,
          };
          
          this.keys.set(keyId, key);
          this.logger.log(`Loaded additional JWT key: ${keyId}`);
        }
      }
    }
  }

  /**
   * Get the current active key for signing
   */
  getCurrentKey(): JwtKey {
    const key = this.keys.get(this.currentKeyId);
    if (!key) {
      throw new Error(`Current JWT key not found: ${this.currentKeyId}`);
    }
    return key;
  }

  /**
   * Get a key by ID for verification
   */
  getKey(keyId: string): JwtKey | null {
    return this.keys.get(keyId) || null;
  }

  /**
   * Get all active keys
   */
  getActiveKeys(): JwtKey[] {
    return Array.from(this.keys.values()).filter(key => key.isActive);
  }

  /**
   * Generate a new key and set it as current (manual rotation)
   */
  rotateKey(): JwtKey {
    const newKeyId = this.generateKeyId();
    const newSecret = this.generateSecret();
    
    const newKey: JwtKey = {
      id: newKeyId,
      secret: newSecret,
      algorithm: 'HS256',
      createdAt: new Date(),
      isActive: true,
    };

    this.keys.set(newKeyId, newKey);
    
    // Keep old key active for verification but switch to new key for signing
    const oldKeyId = this.currentKeyId;
    this.currentKeyId = newKeyId;

    this.logger.log(`JWT key rotated: ${oldKeyId} -> ${newKeyId}`);
    
    // TODO: In production, you would want to:
    // 1. Persist the new key to secure storage
    // 2. Schedule deactivation of the old key after token expiry period
    // 3. Notify all services about the key rotation

    return newKey;
  }

  /**
   * Deactivate a key (should be done after all tokens using it expire)
   */
  deactivateKey(keyId: string): boolean {
    const key = this.keys.get(keyId);
    if (!key) {
      this.logger.warn(`Attempted to deactivate non-existent key: ${keyId}`);
      return false;
    }

    if (keyId === this.currentKeyId) {
      this.logger.warn(`Cannot deactivate current signing key: ${keyId}`);
      return false;
    }

    key.isActive = false;
    this.logger.log(`Deactivated JWT key: ${keyId}`);
    return true;
  }

  /**
   * Remove a deactivated key completely
   */
  removeKey(keyId: string): boolean {
    const key = this.keys.get(keyId);
    if (!key) {
      return false;
    }

    if (key.isActive) {
      this.logger.warn(`Cannot remove active key: ${keyId}. Deactivate first.`);
      return false;
    }

    if (keyId === this.currentKeyId) {
      this.logger.warn(`Cannot remove current signing key: ${keyId}`);
      return false;
    }

    this.keys.delete(keyId);
    this.logger.log(`Removed JWT key: ${keyId}`);
    return true;
  }

  /**
   * Get key rotation policy from configuration
   */
  getRotationPolicy(): { autoRotate: boolean; rotationInterval: number; keyRetentionPeriod: number } {
    return {
      autoRotate: this.configService.get<string>('JWT_AUTO_ROTATE') === 'true',
      rotationInterval: parseInt(this.configService.get<string>('JWT_ROTATION_INTERVAL') || '604800000', 10), // 7 days default
      keyRetentionPeriod: parseInt(this.configService.get<string>('JWT_KEY_RETENTION') || '1209600000', 10), // 14 days default
    };
  }

  /**
   * Check if automatic key rotation is due
   */
  isRotationDue(): boolean {
    const policy = this.getRotationPolicy();
    if (!policy.autoRotate) {
      return false;
    }

    const currentKey = this.getCurrentKey();
    const age = Date.now() - currentKey.createdAt.getTime();
    
    return age >= policy.rotationInterval;
  }

  /**
   * Cleanup old deactivated keys
   */
  cleanupOldKeys(): number {
    const policy = this.getRotationPolicy();
    const cutoffTime = Date.now() - policy.keyRetentionPeriod;
    let removedCount = 0;

    for (const [keyId, key] of this.keys.entries()) {
      if (!key.isActive && key.createdAt.getTime() < cutoffTime) {
        if (this.removeKey(keyId)) {
          removedCount++;
        }
      }
    }

    if (removedCount > 0) {
      this.logger.log(`Cleaned up ${removedCount} old JWT keys`);
    }

    return removedCount;
  }

  private generateKeyId(): string {
    const timestamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const random = crypto.randomBytes(4).toString('hex');
    return `key-${timestamp}-${random}`;
  }

  private generateSecret(): string {
    return crypto.randomBytes(64).toString('base64');
  }
}