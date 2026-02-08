import { Logger } from '@nestjs/common';

/**
 * Monkey-patch NestJS Logger to add automatic error throttling
 *
 * Call this ONCE at app startup (in main.ts) to enable throttling globally.
 *
 * How it works:
 * - Intercepts Logger.prototype.error() and Logger.prototype.warn()
 * - Adds throttling logic transparently
 * - ALL existing code that uses Logger gets throttling automatically
 * - Zero code changes needed anywhere else
 *
 * Usage in main.ts:
 * ```typescript
 * import { setupThrottledLogging } from './core/logging/setup-throttled-logging';
 *
 * async function bootstrap() {
 *   setupThrottledLogging(); // <-- Add this line at the very top
 *   const app = await NestFactory.create(AppModule);
 *   // ... rest of bootstrap
 * }
 * ```
 */

interface ThrottleState {
  lastLog: number;
  count: number;
  lastMessage: string;
}

const throttleMap = new Map<string, ThrottleState>();
const THROTTLE_MS = 10000; // 10 seconds

const REDIS_ERROR_PATTERNS = [
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'ENOTFOUND',
  'Connection is closed',
  'Stream isn\'t writeable',
  'enableOfflineQueue',
  'Worker error',
  'Queue events error',
];

function extractMessage(msg: any): string {
  if (typeof msg === 'string') return msg;
  if (msg instanceof Error) return msg.message || msg.toString();
  if (msg && typeof msg === 'object' && 'message' in msg) {
    return String(msg.message);
  }
  return String(msg);
}

function isRedisError(message: string): boolean {
  return REDIS_ERROR_PATTERNS.some(pattern => message.includes(pattern));
}

function shouldThrottle(context: string, message: string): boolean {
  const key = `${context}:${message.substring(0, 100)}`; // Use first 100 chars as key
  const now = Date.now();
  const state = throttleMap.get(key);

  if (!state) {
    throttleMap.set(key, { lastLog: now, count: 1, lastMessage: message });
    return false; // First occurrence - don't throttle
  }

  const timeSinceLastLog = now - state.lastLog;

  if (timeSinceLastLog >= THROTTLE_MS) {
    // Throttle period passed - log again with count
    const count = state.count;
    throttleMap.set(key, { lastLog: now, count: 1, lastMessage: message });

    // Return the count so caller can log it
    if (count > 1) {
      setTimeout(() => {
        console.log(`[${context}] ↻ Previous error repeated ${count} time(s) in last ${THROTTLE_MS / 1000}s`);
      }, 0);
    }

    return false; // Log it
  }

  // Still within throttle period
  state.count++;
  return true; // Throttle it
}

export function setupThrottledLogging() {
  const originalError = Logger.prototype.error;
  const originalWarn = Logger.prototype.warn;

  // Override error method
  Logger.prototype.error = function (message: any, ...optionalParams: any[]) {
    const msg = extractMessage(message);
    const context = this.context || 'Application';

    // Only throttle Redis errors and repeated worker/queue errors
    if (isRedisError(msg)) {
      if (shouldThrottle(context, msg)) {
        return; // Throttled - skip logging
      }

      // Log the error
      originalError.call(this, message, ...optionalParams);

      // Add helpful hint for Redis errors
      if (msg.includes('ECONNREFUSED') || msg.includes('Connection is closed')) {
        originalWarn.call(
          this,
          '💡 If Redis is down, services will reconnect automatically when Redis comes back up'
        );
      }
    } else {
      // Not a Redis error - log normally
      originalError.call(this, message, ...optionalParams);
    }
  };

  // Override warn method
  Logger.prototype.warn = function (message: any, context?: string) {
    const msg = extractMessage(message);
    const ctx = context || this.context || 'Application';

    if (isRedisError(msg) && shouldThrottle(ctx, msg)) {
      return; // Throttled
    }

    // Call with only message if context is undefined (prevents "undefined" logs)
    if (context === undefined) {
      originalWarn.call(this, message);
    } else {
      originalWarn.call(this, message, context);
    }
  };

  // Cleanup old entries every minute to prevent memory leak
  setInterval(() => {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, state] of throttleMap.entries()) {
      if (now - state.lastLog > THROTTLE_MS * 2) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => throttleMap.delete(key));
  }, 60000);

  console.log('✅ Throttled logging enabled globally');
}
