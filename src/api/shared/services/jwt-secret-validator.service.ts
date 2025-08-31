import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class JwtSecretValidatorService {
  private readonly logger = new Logger(JwtSecretValidatorService.name);
  
  // List of known weak/default secrets to reject
  private readonly FORBIDDEN_SECRETS = [
    'your_very_secure_jwt_secret_key_here_at_least_32_characters',
    'secret',
    'jwt-secret',
    'jwt_secret',
    'mysecret',
    'secret123',
    '123456',
    'password',
    'jwt-key',
    'default',
    'changeme',
    'please-change-me',
    'super-secret',
    'super_secret',
  ];

  /**
   * Calculate Shannon entropy of a string
   * Higher entropy indicates better randomness/security
   */
  private calculateEntropy(str: string): number {
    const freq: Record<string, number> = {};
    
    // Count character frequencies
    for (const char of str) {
      freq[char] = (freq[char] || 0) + 1;
    }
    
    // Calculate Shannon entropy
    let entropy = 0;
    const length = str.length;
    
    for (const count of Object.values(freq)) {
      const probability = count / length;
      entropy -= probability * Math.log2(probability);
    }
    
    return entropy;
  }

  /**
   * Check if string contains repeated patterns that reduce security
   */
  private hasRepeatedPatterns(str: string): boolean {
    // Check for simple repeated characters (e.g., "aaaa", "1111")
    if (/(.)\1{3,}/.test(str)) {
      return true;
    }
    
    // Check for repeated short patterns (e.g., "abcabc", "123123")
    for (let len = 2; len <= Math.min(8, str.length / 2); len++) {
      const pattern = str.substring(0, len);
      const repeated = pattern.repeat(Math.floor(str.length / len));
      if (str.startsWith(repeated) && repeated.length >= str.length * 0.7) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Check if string is likely a common dictionary word or predictable sequence
   */
  private isPredictableSequence(str: string): boolean {
    const lower = str.toLowerCase();
    
    // Common sequences
    const sequences = [
      'abcdefghijklmnopqrstuvwxyz',
      '0123456789',
      'qwertyuiop',
      'asdfghjkl',
      'zxcvbnm',
      '!@#$%^&*()',
    ];
    
    for (const seq of sequences) {
      if (lower.includes(seq.substring(0, Math.min(6, seq.length)))) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Validate JWT secret meets security requirements
   */
  validateJwtSecret(secret: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    // Check if secret exists
    if (!secret) {
      errors.push('JWT_SECRET is required');
      return { valid: false, errors };
    }
    
    // Check minimum length (64 characters for high security)
    if (secret.length < 64) {
      errors.push(`JWT_SECRET must be at least 64 characters long (current: ${secret.length})`);
    }
    
    // Check against forbidden/default values
    if (this.FORBIDDEN_SECRETS.includes(secret.toLowerCase())) {
      errors.push('JWT_SECRET cannot be a default or common value');
    }
    
    // Check entropy (should be >= 4.0 for good randomness)
    const entropy = this.calculateEntropy(secret);
    if (entropy < 4.0) {
      errors.push(`JWT_SECRET has insufficient entropy (${entropy.toFixed(2)}). Use more random characters.`);
    }
    
    // Check for repeated patterns
    if (this.hasRepeatedPatterns(secret)) {
      errors.push('JWT_SECRET contains repeated patterns that reduce security');
    }
    
    // Check for predictable sequences
    if (this.isPredictableSequence(secret)) {
      errors.push('JWT_SECRET contains predictable sequences');
    }
    
    // Check character diversity (should use multiple character types)
    const hasLower = /[a-z]/.test(secret);
    const hasUpper = /[A-Z]/.test(secret);
    const hasDigits = /\d/.test(secret);
    const hasSymbols = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(secret);
    
    const charTypes = [hasLower, hasUpper, hasDigits, hasSymbols].filter(Boolean).length;
    if (charTypes < 3) {
      errors.push('JWT_SECRET should include at least 3 different character types (lowercase, uppercase, digits, symbols)');
    }
    
    const isValid = errors.length === 0;
    
    if (isValid) {
      this.logger.log('JWT secret validation passed');
    } else {
      this.logger.error('JWT secret validation failed:', errors.join('; '));
    }
    
    return { valid: isValid, errors };
  }

  /**
   * Generate a secure JWT secret recommendation
   */
  generateSecureSecret(): string {
    // Generate a cryptographically secure random secret
    const crypto = require('crypto');
    return crypto.randomBytes(64).toString('base64');
  }

  /**
   * Provide recommendations for a secure JWT secret
   */
  getSecurityRecommendations(): string[] {
    return [
      'Use a randomly generated secret of at least 64 characters',
      'Include uppercase letters, lowercase letters, numbers, and symbols',
      'Avoid dictionary words, common phrases, or predictable patterns',
      'Use environment variables to store the secret securely',
      'Rotate secrets periodically (every 3-6 months)',
      'Never commit secrets to version control',
      'Use different secrets for different environments (dev, staging, prod)',
    ];
  }
}