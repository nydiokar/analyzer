import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import Redis from 'ioredis';

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
  private readonly REFRESH_TTL = 7 * 24 * 60 * 60; // 7 days in seconds
  private readonly ABSOLUTE_REFRESH_TTL = 30 * 24 * 60 * 60; // 30 days in seconds (defense-in-depth)
  
  constructor(private readonly configService: ConfigService) {
    // Initialize Redis connection
    const redisUrl = this.configService.get<string>('REDIS_URL') || 'redis://localhost:6379';
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    this.redis.on('error', (error) => {
      this.logger.error('Redis connection error:', error);
    });

    this.redis.on('connect', () => {
      this.logger.log('Redis connected successfully');
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
    try {
      // Get session ID from hashed refresh token
      const tokenHash = this.hashToken(refreshToken);
      const tokenKey = this.tokenKey(tokenHash);
      const sessionId = await this.redis.get(tokenKey);
      
      if (!sessionId) {
        this.logger.warn('Invalid or expired refresh token');
        return null;
      }

      // Get session data
      const sessionKey = this.sessionKey(sessionId);
      const sessionData = await this.redis.get(sessionKey);
      
      if (!sessionData) {
        this.logger.warn(`Session not found for ID: ${sessionId}`);
        return null;
      }

      const session: RefreshSession = JSON.parse(sessionData);

      // Detect reuse/replay quickly
      if (session.status !== 'active') {
        this.logger.error(`Refresh token reuse detected for user ${session.userId} (session ${session.sessionId})`);
        await this.handleReplay(session);
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

      // Remove old token and session
      await this.redis.setex(sessionKey, this.REFRESH_TTL, JSON.stringify({ ...session, status: 'rotated' }));
      await this.redis.setex(tokenKey, this.REFRESH_TTL, sessionId); // keep mapping to detect replay

      this.logger.log(`Rotated refresh token for user ${session.userId}: ${sessionId} -> ${newSessionId}`);
      
      return { newRefreshToken, session: newSession };
    } catch (error) {
      this.logger.error('Error rotating refresh token:', error);
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
      this.logger.error('Error getting session by refresh token:', error);
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
      this.logger.error(`Error revoking session ${sessionId}:`, error);
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
      this.logger.error(`Error revoking all sessions for user ${userId}:`, error);
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
      this.logger.error(`Error getting sessions for user ${userId}:`, error);
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
      this.logger.error('Error detecting replay:', error);
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
      this.logger.error('Error cleaning up expired sessions:', error);
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
