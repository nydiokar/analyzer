/**
 * String sanitization utilities for database operations
 * Handles PostgreSQL UTF-8 encoding issues (null bytes, invalid characters)
 */

/**
 * Removes null bytes (0x00) and other PostgreSQL-incompatible characters from strings
 * PostgreSQL's UTF-8 encoding doesn't allow null bytes which can appear in Solana transaction data
 *
 * @param value - The value to sanitize (string, number, object, array, or null/undefined)
 * @returns Sanitized value with null bytes removed
 */
export function sanitizeForPostgres(value: any): any {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    // Remove null bytes (0x00) and other control characters except newlines/tabs
    return value
      .replace(/\0/g, '') // Remove null bytes
      .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''); // Remove other control chars except \n, \t, \r
  }

  if (typeof value === 'object') {
    if (Array.isArray(value)) {
      return value.map(item => sanitizeForPostgres(item));
    }

    // Handle plain objects
    const sanitized: Record<string, any> = {};
    for (const [key, val] of Object.entries(value)) {
      sanitized[key] = sanitizeForPostgres(val);
    }
    return sanitized;
  }

  // Return other types unchanged (numbers, booleans, etc.)
  return value;
}

/**
 * Sanitizes a Prisma input object to ensure all string fields are PostgreSQL-safe
 * Useful for batch operations where invalid data could fail entire batches
 *
 * @param input - Prisma create/update input object
 * @returns Sanitized input object
 */
export function sanitizePrismaInput<T extends Record<string, any>>(input: T): T {
  return sanitizeForPostgres(input) as T;
}
