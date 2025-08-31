# ⚙️ Security Configuration Guide

## Environment Variables

### **Core Authentication**
```bash
# CRITICAL: Generate secure secrets
JWT_SECRET="your_cryptographically_secure_64_character_secret"
JWT_EXPIRES_IN=7d

# Password security enhancement
PASSWORD_PEPPER="your_secure_random_64_char_hex_string"
```

**Generate secure secrets:**
```bash
# JWT Secret (64+ characters, high entropy)
node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"

# Password Pepper (64 hex characters)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### **Authentication Modes**
```bash
# Backend cookie mode (recommended for production)
AUTH_COOKIE_MODE=false              # Set 'true' for httpOnly cookies
AUTH_COOKIE_NAME=analyzer.sid
AUTH_COOKIE_SECURE=true            # Require HTTPS

# Frontend storage mode
NEXT_PUBLIC_AUTH_COOKIE_MODE=false  # 'true' for production
NEXT_PUBLIC_AUTH_MEMORY_MODE=false  # 'true' for high security (lost on refresh)
```

### **Security Alert Thresholds**
```bash
# Events per hour that trigger alerts
SECURITY_CRITICAL_THRESHOLD=3       # Critical security events
SECURITY_HIGH_THRESHOLD=10          # High-severity events  
SECURITY_SUSPICIOUS_IPS_THRESHOLD=5 # Unique suspicious IPs
SECURITY_RATE_LIMIT_THRESHOLD=20    # Rate limit violations
SECURITY_FAILED_LOGINS_THRESHOLD=15 # Failed login attempts
```

### **Notification Channels (Optional)**
```bash
# Webhook notifications
SECURITY_WEBHOOK_URL=https://your-webhook-url.com/security

# Email notifications
SMTP_HOST=your-smtp-server.com
SMTP_PORT=587
SMTP_USER=alerts@yourcompany.com  
SMTP_PASS=your-email-password

# Telegram notifications (uses existing bot config)
TELEGRAM_BOT_TOKEN=your_bot_token
ADMIN_TELEGRAM_ID=your_chat_id
```

## 🔧 Configuration Profiles

### **Development Profile**
```bash
# .env.development
JWT_SECRET="dev_secret_at_least_64_characters_for_development_only_never_production"
PASSWORD_PEPPER="dev_pepper_32_chars_hex_development_only"
AUTH_COOKIE_SECURE=false
NEXT_PUBLIC_AUTH_COOKIE_MODE=false
SECURITY_CRITICAL_THRESHOLD=1       # Lower thresholds for testing
SECURITY_HIGH_THRESHOLD=3
```

### **Production Profile**  
```bash
# .env.production
JWT_SECRET="[GENERATE_SECURE_SECRET]"
PASSWORD_PEPPER="[GENERATE_SECURE_PEPPER]"
AUTH_COOKIE_MODE=true
AUTH_COOKIE_SECURE=true
NEXT_PUBLIC_AUTH_COOKIE_MODE=true
SECURITY_WEBHOOK_URL=https://your-monitoring.com/webhook
# ... notification settings
```

### **High Security Profile**
```bash
# .env.high-security
JWT_SECRET="[ULTRA_SECURE_SECRET]"
PASSWORD_PEPPER="[ULTRA_SECURE_PEPPER]"
AUTH_COOKIE_MODE=true
AUTH_COOKIE_SECURE=true
NEXT_PUBLIC_AUTH_MEMORY_MODE=true   # Tokens lost on refresh
SECURITY_CRITICAL_THRESHOLD=1       # Ultra-sensitive
SECURITY_HIGH_THRESHOLD=5
SECURITY_SUSPICIOUS_IPS_THRESHOLD=2
```

## 📊 Rate Limiting Configuration

### **Default Rate Limits**
| Endpoint | Limit | Window | Purpose |
|----------|-------|--------|---------|
| `/auth/register` | 5 req/min | 1 minute | Prevent account spam |
| `/auth/login` | 10 req/min | 1 minute | Prevent brute force |
| `/auth/verify-email` | 3 req/5min | 5 minutes | Prevent token spam |
| `/auth/request-verification` | 2 req/hour | 1 hour | Prevent email spam |
| `/users/me` | 30 req/min | 1 minute | Profile access |
| `/security/*` | 10-20 req/min | 1 minute | Security monitoring |
| `/bot/*` | 20-60 req/min | 1 minute | Bot integration |

### **Progressive Backoff**
- **Level 1**: 3 violations → 1 minute block
- **Level 2**: 4 violations → 2 minute block  
- **Level 3**: 5 violations → 4 minute block
- **Level 4**: 6 violations → 8 minute block
- **Level 5**: 7+ violations → 16 minute block
- **Maximum**: 32 minute block (escalates to 60 minutes)

## 🛡️ Security Validation

### **JWT Secret Requirements**
- ✅ Minimum 64 characters
- ✅ High entropy (Shannon entropy ≥ 4.0)
- ✅ Mixed character types (3+ different types)
- ❌ Not default/common values
- ❌ No repeated patterns
- ❌ No predictable sequences

### **Password Requirements**
- ✅ Minimum 8 characters
- ✅ At least 1 uppercase letter
- ✅ At least 1 lowercase letter  
- ✅ At least 1 number
- ✅ Special characters allowed: `@$!%*?&`

### **API Key Generation**
- ✅ Cryptographically secure (`crypto.randomBytes()`)
- ✅ 64 hexadecimal characters (32 bytes)
- ✅ Unique per user
- ✅ Separate hashing from passwords

## 🔍 Monitoring Configuration

### **Log Levels**
```javascript
// Security event severities
'CRITICAL': Immediate threat, requires action
'HIGH':     Elevated risk, monitor closely  
'MEDIUM':   Noteworthy activity, periodic review
'LOW':      Normal operations, info only
```

### **Alert Triggers**
```javascript
// What triggers each alert level
CRITICAL: {
  - 3+ critical security events/hour
  - Active security breaches
  - System compromise indicators
}

HIGH: {
  - 10+ high-severity events/hour
  - 5+ suspicious IPs/hour
  - Coordinated attack patterns
}

MEDIUM: {
  - 20+ rate limit violations/hour
  - 15+ failed logins/hour
  - Unusual traffic patterns  
}
```

## 🚀 Deployment Checklist

### **Pre-Production**
- [ ] Generate secure JWT_SECRET (64+ chars)
- [ ] Generate secure PASSWORD_PEPPER (64 hex chars)
- [ ] Set AUTH_COOKIE_SECURE=true
- [ ] Configure HTTPS enforcement
- [ ] Set production alert thresholds
- [ ] Configure notification channels
- [ ] Test security endpoints
- [ ] Verify rate limiting works

### **Production**
- [ ] Enable httpOnly cookies (`AUTH_COOKIE_MODE=true`)
- [ ] Set secure frontend storage (`NEXT_PUBLIC_AUTH_COOKIE_MODE=true`)  
- [ ] Configure monitoring webhooks
- [ ] Set up log aggregation
- [ ] Configure backup notification channels
- [ ] Test alert escalation
- [ ] Document incident response procedures

### **High Security Environments**
- [ ] Enable memory-only token storage
- [ ] Lower alert thresholds
- [ ] Add geographic restrictions
- [ ] Implement CAPTCHA for auth endpoints
- [ ] Add multi-factor authentication
- [ ] Configure SIEM integration
- [ ] Set up automated incident response

## 🔧 Configuration Validation

Test your configuration:
```bash
# Validate security settings
curl http://localhost:3000/security/health

# Test alert thresholds (in development)
# Trigger rate limits to test alerting
for i in {1..25}; do curl http://localhost:3000/auth/login; done
```