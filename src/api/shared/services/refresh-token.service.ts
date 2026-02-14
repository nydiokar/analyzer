import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import Redis from 'ioredis';
import { getErrorMessage, getErrorDetails } from '../../../core/utils/error-utils';


export interface RefreshSession {
  sessionId: string;
  userId: string;
  tokenHash: string;
  deviceLabel?: string;
  createdAt: Date;
  expiresAt: Date;
  absoluteExpiresAt?: Date;
  status: 'active' | 'rotated' | 'revoked' | 'expired' | 'reused';
  prevSessionId?: string; // For rotation detection
  rotatedAt?: Date; // When token was rotated
  nextSessionId?: string; // Points to the new session after rotation
}

export interface RefreshTokens {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);
  private readonly redis: Redis;
  private readonly REFRESH_PREFIX = 'refresh_session:';
  private readonly REFRESH_TOKEN_PREFIX = 'refresh_token_hash:';
  private readonly USER_SESSIONS_PREFIX = 'user_sessions:';
  private readonly REFRESH_TTL: number; // seconds
  private readonly ABSOLUTE_REFRESH_TTL: number; // seconds (defense-in-depth)
  private readonly ROTATION_GRACE_PERIOD = 60; // seconds - allow concurrent refreshes within this window
  
  constructor(private readonly configService: ConfigService) {
    this.logger.log('Initializing RefreshTokenService instance');

    // TTLs are env-driven with sane defaults
    const refreshTtlDays = Number(this.configService.get<string>('REFRESH_TOKEN_TTL_DAYS') || 7);
    const absoluteRefreshTtlDays = Number(this.configService.get<string>('REFRESH_TOKEN_ABSOLUTE_TTL_DAYS') || 30);
    this.REFRESH_TTL = refreshTtlDays * 24 * 60 * 60;
    this.ABSOLUTE_REFRESH_TTL = absoluteRefreshTtlDays * 24 * 60 * 60;

    // Initialize Redis connection
    const redisUrl = this.configService.get<string>('REDIS_URL') || 'redis://localhost:6379';
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    this.redis.on('error', (error) => {
      this.logger.error('Redis connection error:', getErrorMessage(error));
    });

    this.redis.on('connect', () => {
      this.logger.log('Redis connected successfully');
    });

    this.redis.on('ready', () => {
      this.logger.log('Redis connection ready and authenticated');
    });

    this.redis.on('reconnecting', (delay: number) => {
      this.logger.warn(`Redis reconnecting in ${delay}ms...`);
    });

    this.redis.on('close', () => {
      this.logger.warn('Redis connection closed');
    });

    this.redis.on('end', () => {
      this.logger.warn('Redis connection ended (will not reconnect)');
    });
  }

  /**
   * Create a new refresh session
   */
  async createRefreshSession(userId: string, deviceLabel?: string): Promise<string> {
    const sessionId = this.generateSessionId();
    const refreshToken = this.generateRefreshToken();
    const tokenHash = this.hashToken(refreshToken);
    
    const session: RefreshSession = {
      sessionId,
      userId,
      tokenHash,
      deviceLabel,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + this.REFRESH_TTL * 1000),
      absoluteExpiresAt: new Date(Date.now() + this.ABSOLUTE_REFRESH_TTL * 1000),
      status: 'active',
    };

    // Store session in Redis
    const key = this.sessionKey(sessionId);
    await this.redis.setex(key, this.REFRESH_TTL, JSON.stringify(session));
    
    // Also store the mapping from hashed refresh token to session
    const tokenKey = this.tokenKey(tokenHash);
    await this.redis.setex(tokenKey, this.REFRESH_TTL, sessionId);

    // Track sessions per user for O(1) revocation
    await this.redis.sadd(this.userSessionsKey(userId), sessionId);
    await this.redis.expire(this.userSessionsKey(userId), this.REFRESH_TTL);

    this.logger.log(`Created refresh session for user ${userId}: ${sessionId}`);
    return refreshToken;
  }

  /**
   * Validate and rotate refresh token
   */
  async rotateRefreshToken(refreshToken: string): Promise<{ newRefreshToken: string; session: RefreshSession } | null> {
    const tokenHash = this.hashToken(refreshToken);
    const rotationId = crypto.randomBytes(4).toString('hex');

    try {
      // Get session ID from hashed refresh token
      const tokenKey = this.tokenKey(tokenHash);
      const sessionId = await this.redis.get(tokenKey);

      if (!sessionId) {
        this.logger.warn(`[${rotationId}] Invalid or expired refresh token`);
        return null;
      }

      this.logger.debug(`[${rotationId}] Attempting to rotate session ${sessionId}`);

      // Get session data
      const sessionKey = this.sessionKey(sessionId);
      const sessionData = await this.redis.get(sessionKey);

      if (!sessionData) {
        this.logger.warn(`[${rotationId}] Session not found for ID: ${sessionId}`);
        return null;
      }

      const session: RefreshSession = JSON.parse(sessionData);

      // Detect reuse/replay with grace period for concurrent requests
      if (session.status !== 'active') {
        // Check if this is a concurrent refresh within the grace period
        if (session.status === 'rotated' && session.rotatedAt && session.nextSessionId) {
          const rotatedAt = new Date(session.rotatedAt);
          const now = new Date();
          const secondsSinceRotation = (now.getTime() - rotatedAt.getTime()) / 1000;
          const minutesSinceRotation = secondsSinceRotation / 60;

          // If rotated more than 30 minutes ago, treat as stale tab (not replay attack)
          // This prevents logging out all sessions when a tab wakes up after sleeping
          if (minutesSinceRotation > 30) {
            this.logger.warn(`[${rotationId}] Stale session detected (rotated ${minutesSinceRotation.toFixed(1)} minutes ago) for user ${session.userId}`);
            this.logger.warn(`[${rotationId}] Likely a tab that was sleeping - rejecting without revoking other sessions`);
            return null; // Just return null, don't trigger replay attack handling
          }

          if (secondsSinceRotation <= this.ROTATION_GRACE_PERIOD) {
            // Within grace period - this is likely a concurrent request from another tab
            this.logger.debug(`[${rotationId}] Concurrent refresh detected within grace period (${secondsSinceRotation.toFixed(2)}s) for user ${session.userId}`);

            // Return the same new session that was created during rotation
            const newSessionKey = this.sessionKey(session.nextSessionId);
            const newSessionData = await this.redis.get(newSessionKey);

            if (newSessionData) {
              const newSession: RefreshSession = JSON.parse(newSessionData);

              // Regenerate the refresh token from the new session
              // We can't return the exact same token, but we can provide the new session info
              this.logger.log(`[${rotationId}] Allowing concurrent refresh for user ${session.userId}, pointing to session ${session.nextSessionId}`);

              // Generate a new token for this concurrent request (alternative approach)
              // This ensures each tab gets its own token but doesn't trigger a replay attack
              const concurrentRefreshToken = this.generateRefreshToken();
              const concurrentTokenHash = this.hashToken(concurrentRefreshToken);

              // Map this new token to the already-created session
              const concurrentTokenKey = this.tokenKey(concurrentTokenHash);
              await this.redis.setex(concurrentTokenKey, this.REFRESH_TTL, session.nextSessionId);

              return { newRefreshToken: concurrentRefreshToken, session: newSession };
            }
          }

          // Between grace period and 30 minutes - likely replay attack or race condition
          this.logger.error(`[${rotationId}] Potential replay attack detected for user ${session.userId} (rotated ${minutesSinceRotation.toFixed(1)} minutes ago)`);
          this.logger.error(`[${rotationId}] Session ${session.sessionId} status: ${session.status}`);
          await this.handleReplay(session);
          return null;
        }

        // Other status (expired, revoked, reused) - reject without details
        this.logger.warn(`[${rotationId}] Invalid session status: ${session.status} for user ${session.userId}`);
        return null;
      }
      
      // Check if session is expired
      if (new Date(session.expiresAt) < new Date() || (session.absoluteExpiresAt && new Date(session.absoluteExpiresAt) < new Date())) {
        this.logger.warn(`Expired session: ${sessionId}`);
        await this.markSessionStatus(sessionId, 'expired');
        return null;
      }

      // Generate new refresh token
      const newRefreshToken = this.generateRefreshToken();
      const newSessionId = this.generateSessionId();
      const newTokenHash = this.hashToken(newRefreshToken);
      
      // Create new session with reference to previous one for replay detection
      const newSession: RefreshSession = {
        sessionId: newSessionId,
        userId: session.userId,
        deviceLabel: session.deviceLabel,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + this.REFRESH_TTL * 1000),
        absoluteExpiresAt: session.absoluteExpiresAt || new Date(Date.now() + this.ABSOLUTE_REFRESH_TTL * 1000),
        status: 'active',
        prevSessionId: sessionId,
        tokenHash: newTokenHash,
      };

      // Store new session
      const newSessionKey = this.sessionKey(newSessionId);
      await this.redis.setex(newSessionKey, this.REFRESH_TTL, JSON.stringify(newSession));
      
      // Store new token mapping
      const newTokenKey = this.tokenKey(newTokenHash);
      await this.redis.setex(newTokenKey, this.REFRESH_TTL, newSessionId);

      // Update user session set
      await this.redis.srem(this.userSessionsKey(session.userId), sessionId);
      await this.redis.sadd(this.userSessionsKey(session.userId), newSessionId);
      await this.redis.expire(this.userSessionsKey(session.userId), this.REFRESH_TTL);

      // Mark old session as rotated with reference to new session
      const rotatedSession = {
        ...session,
        status: 'rotated' as const,
        rotatedAt: new Date(),
        nextSessionId: newSessionId,
      };
      await this.redis.setex(sessionKey, this.REFRESH_TTL, JSON.stringify(rotatedSession));
      await this.redis.setex(tokenKey, this.REFRESH_TTL, sessionId); // keep mapping to detect replay

      this.logger.log(`[${rotationId}] Rotated refresh token for user ${session.userId}: ${sessionId} -> ${newSessionId}`);

      return { newRefreshToken, session: newSession };
    } catch (error) {
      this.logger.error(`[${rotationId}] Error rotating refresh token:`, getErrorMessage(error));
      return null;
    }
  }

  /**
   * Get session by refresh token
   */
  async getSessionByRefreshToken(refreshToken: string): Promise<RefreshSession | null> {
    try {
      const tokenHash = this.hashToken(refreshToken);
      const tokenKey = this.tokenKey(tokenHash);
      const sessionId = await this.redis.get(tokenKey);
      
      if (!sessionId) {
        return null;
      }

      const sessionKey = this.sessionKey(sessionId);
      const sessionData = await this.redis.get(sessionKey);
      
      if (!sessionData) {
        return null;
      }

      const session: RefreshSession = JSON.parse(sessionData);
      
      // Check expiry
      if (new Date(session.expiresAt) < new Date() || (session.absoluteExpiresAt && new Date(session.absoluteExpiresAt) < new Date())) {
        await this.markSessionStatus(sessionId, 'expired');
        return null;
      }

      if (session.status !== 'active') {
        await this.handleReplay(session);
        return null;
      }

      return session;
    } catch (error) {
      this.logger.error('Error getting session by refresh token:', getErrorMessage(error));
      return null;
    }
  }

  /**
   * Revoke a specific session
   */
  async revokeSession(sessionId: string): Promise<void> {
    try {
      const sessionKey = this.sessionKey(sessionId);
      const sessionData = await this.redis.get(sessionKey);
      
      const session: RefreshSession | null = sessionData ? JSON.parse(sessionData) : null;
      if (session?.tokenHash) {
        await this.redis.del(this.tokenKey(session.tokenHash));
      }

      await this.redis.del(sessionKey);
      if (session?.userId) {
        await this.redis.srem(this.userSessionsKey(session.userId), sessionId);
      }
      this.logger.log(`Revoked session: ${sessionId}`);
    } catch (error) {
      this.logger.error(`Error revoking session ${sessionId}:`, getErrorMessage(error));
    }
  }

  /**
   * Revoke all sessions for a user
   */
  async revokeAllUserSessions(userId: string): Promise<void> {
    try {
      const userSessionsKey = this.userSessionsKey(userId);
      const sessionIds = await this.redis.smembers(userSessionsKey);

      for (const sessionId of sessionIds) {
        await this.revokeSession(sessionId);
      }

      await this.redis.del(userSessionsKey);
      this.logger.log(`Revoked all sessions for user: ${userId}`);
    } catch (error) {
      this.logger.error(`Error revoking all sessions for user ${userId}:`, getErrorMessage(error));
    }
  }

  /**
   * Get all sessions for a user (for device management)
   */
  async getUserSessions(userId: string): Promise<RefreshSession[]> {
    try {
      const sessionIds = await this.redis.smembers(this.userSessionsKey(userId));
      const sessions: RefreshSession[] = [];

      for (const sessionId of sessionIds) {
        const sessionData = await this.redis.get(this.sessionKey(sessionId));
        if (sessionData) {
          const session: RefreshSession = JSON.parse(sessionData);
          if (
            session.userId === userId &&
            session.status === 'active' &&
            new Date(session.expiresAt) > new Date() &&
            (!session.absoluteExpiresAt || new Date(session.absoluteExpiresAt) > new Date())
          ) {
            sessions.push(session);
          } else if (session.status !== 'active') {
            // Clean up stale references
            await this.redis.srem(this.userSessionsKey(userId), sessionId);
          }
        } else {
          await this.redis.srem(this.userSessionsKey(userId), sessionId);
        }
      }

      return sessions;
    } catch (error) {
      this.logger.error(`Error getting sessions for user ${userId}:`, getErrorMessage(error));
      return [];
    }
  }

  /**
   * Detect refresh token replay attack
   */
  async detectReplay(refreshToken: string): Promise<boolean> {
    try {
      const tokenHash = this.hashToken(refreshToken);
      const sessionId = await this.redis.get(this.tokenKey(tokenHash));
      if (!sessionId) {
        return false;
      }

      const sessionData = await this.redis.get(this.sessionKey(sessionId));
      if (!sessionData) {
        return false;
      }

      const session: RefreshSession = JSON.parse(sessionData);
      if (session.status !== 'active') {
        await this.handleReplay(session);
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error('Error detecting replay:', getErrorMessage(error));
      return false;
    }
  }

  /**
   * Cleanup expired sessions (should be called periodically)
   */
  async cleanupExpiredSessions(): Promise<void> {
    try {
      const sessionKeys = await this.redis.keys(this.REFRESH_PREFIX + '*');
      let cleaned = 0;

      for (const key of sessionKeys) {
        const sessionData = await this.redis.get(key);
        if (sessionData) {
          const session: RefreshSession = JSON.parse(sessionData);
          if (new Date(session.expiresAt) < new Date() || (session.absoluteExpiresAt && new Date(session.absoluteExpiresAt) < new Date())) {
            await this.revokeSession(session.sessionId);
            cleaned++;
          }
        }
      }

      if (cleaned > 0) {
        this.logger.log(`Cleaned up ${cleaned} expired refresh sessions`);
      }
    } catch (error) {
      this.logger.error('Error cleaning up expired sessions:', getErrorMessage(error));
    }
  }

  private generateSessionId(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  private generateRefreshToken(): string {
    return crypto.randomBytes(64).toString('base64url');
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private sessionKey(sessionId: string): string {
    return this.REFRESH_PREFIX + sessionId;
  }

  private tokenKey(tokenHash: string): string {
    return this.REFRESH_TOKEN_PREFIX + tokenHash;
  }

  private userSessionsKey(userId: string): string {
    return `${this.USER_SESSIONS_PREFIX}${userId}`;
  }

  private async markSessionStatus(sessionId: string, status: RefreshSession['status']): Promise<void> {
    const sessionKey = this.sessionKey(sessionId);
    const sessionData = await this.redis.get(sessionKey);
    if (!sessionData) {
      return;
    }

    const session: RefreshSession = JSON.parse(sessionData);
    session.status = status;
    await this.redis.setex(sessionKey, this.REFRESH_TTL, JSON.stringify(session));
    if (status !== 'active' && session.userId) {
      await this.redis.srem(this.userSessionsKey(session.userId), sessionId);
    }
  }

  private async handleReplay(session: RefreshSession): Promise<void> {
    this.logger.error(`Replay detected, revoking all sessions for user ${session.userId}`);
    await this.markSessionStatus(session.sessionId, 'reused');
    await this.revokeAllUserSessions(session.userId);
  }

  async onModuleDestroy() {
    await this.redis.disconnect();
  }
}
