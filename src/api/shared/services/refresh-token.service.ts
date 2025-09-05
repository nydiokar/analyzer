import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import Redis from 'ioredis';

export interface RefreshSession {
  sessionId: string;
  userId: string;
  deviceLabel?: string;
  createdAt: Date;
  expiresAt: Date;
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
  private readonly REFRESH_TTL = 7 * 24 * 60 * 60; // 7 days in seconds
  
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
    
    const session: RefreshSession = {
      sessionId,
      userId,
      deviceLabel,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + this.REFRESH_TTL * 1000),
    };

    // Store session in Redis
    const key = this.REFRESH_PREFIX + sessionId;
    await this.redis.setex(key, this.REFRESH_TTL, JSON.stringify(session));
    
    // Also store the mapping from refresh token to session
    const tokenKey = `refresh_token:${refreshToken}`;
    await this.redis.setex(tokenKey, this.REFRESH_TTL, sessionId);

    this.logger.log(`Created refresh session for user ${userId}: ${sessionId}`);
    return refreshToken;
  }

  /**
   * Validate and rotate refresh token
   */
  async rotateRefreshToken(refreshToken: string): Promise<{ newRefreshToken: string; session: RefreshSession } | null> {
    try {
      // Get session ID from refresh token
      const tokenKey = `refresh_token:${refreshToken}`;
      const sessionId = await this.redis.get(tokenKey);
      
      if (!sessionId) {
        this.logger.warn('Invalid or expired refresh token');
        return null;
      }

      // Get session data
      const sessionKey = this.REFRESH_PREFIX + sessionId;
      const sessionData = await this.redis.get(sessionKey);
      
      if (!sessionData) {
        this.logger.warn(`Session not found for ID: ${sessionId}`);
        return null;
      }

      const session: RefreshSession = JSON.parse(sessionData);
      
      // Check if session is expired
      if (new Date(session.expiresAt) < new Date()) {
        this.logger.warn(`Expired session: ${sessionId}`);
        await this.revokeSession(sessionId);
        return null;
      }

      // Generate new refresh token
      const newRefreshToken = this.generateRefreshToken();
      const newSessionId = this.generateSessionId();
      
      // Create new session with reference to previous one for replay detection
      const newSession: RefreshSession = {
        sessionId: newSessionId,
        userId: session.userId,
        deviceLabel: session.deviceLabel,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + this.REFRESH_TTL * 1000),
        prevSessionId: sessionId,
      };

      // Store new session
      const newSessionKey = this.REFRESH_PREFIX + newSessionId;
      await this.redis.setex(newSessionKey, this.REFRESH_TTL, JSON.stringify(newSession));
      
      // Store new token mapping
      const newTokenKey = `refresh_token:${newRefreshToken}`;
      await this.redis.setex(newTokenKey, this.REFRESH_TTL, newSessionId);

      // Remove old token and session
      await this.redis.del(tokenKey);
      await this.redis.del(sessionKey);

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
      const tokenKey = `refresh_token:${refreshToken}`;
      const sessionId = await this.redis.get(tokenKey);
      
      if (!sessionId) {
        return null;
      }

      const sessionKey = this.REFRESH_PREFIX + sessionId;
      const sessionData = await this.redis.get(sessionKey);
      
      if (!sessionData) {
        return null;
      }

      const session: RefreshSession = JSON.parse(sessionData);
      
      // Check expiry
      if (new Date(session.expiresAt) < new Date()) {
        await this.revokeSession(sessionId);
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
      const sessionKey = this.REFRESH_PREFIX + sessionId;
      const sessionData = await this.redis.get(sessionKey);
      
      if (sessionData) {
        // Find and remove the associated refresh token
        const keys = await this.redis.keys('refresh_token:*');
        for (const key of keys) {
          const storedSessionId = await this.redis.get(key);
          if (storedSessionId === sessionId) {
            await this.redis.del(key);
            break;
          }
        }
      }

      await this.redis.del(sessionKey);
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
      const sessionKeys = await this.redis.keys(this.REFRESH_PREFIX + '*');
      
      for (const key of sessionKeys) {
        const sessionData = await this.redis.get(key);
        if (sessionData) {
          const session: RefreshSession = JSON.parse(sessionData);
          if (session.userId === userId) {
            const sessionId = session.sessionId;
            await this.revokeSession(sessionId);
          }
        }
      }

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
      const sessionKeys = await this.redis.keys(this.REFRESH_PREFIX + '*');
      const sessions: RefreshSession[] = [];

      for (const key of sessionKeys) {
        const sessionData = await this.redis.get(key);
        if (sessionData) {
          const session: RefreshSession = JSON.parse(sessionData);
          if (session.userId === userId && new Date(session.expiresAt) > new Date()) {
            sessions.push(session);
          }
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
      const session = await this.getSessionByRefreshToken(refreshToken);
      if (!session) {
        return false;
      }

      // If the session has a prevSessionId, check if the previous session still exists
      if (session.prevSessionId) {
        const prevSessionKey = this.REFRESH_PREFIX + session.prevSessionId;
        const prevSessionExists = await this.redis.exists(prevSessionKey);
        
        if (prevSessionExists) {
          // This could be a replay attack - revoke all sessions for this user
          this.logger.error(`Potential replay attack detected for user ${session.userId}`);
          await this.revokeAllUserSessions(session.userId);
          return true;
        }
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
          if (new Date(session.expiresAt) < new Date()) {
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

  async onModuleDestroy() {
    await this.redis.disconnect();
  }
}