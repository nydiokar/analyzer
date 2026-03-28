# Prisma Best Practices Audit - analyzer Project

**Audit Date:** 2026-03-28
**Scope:** Schema design, query patterns, connection management, testing, and security

---

## ✅ STRONG PRACTICES (Well Implemented)

### 1. **Single Global PrismaClient Instance**
**Status:** ✅ EXCELLENT
**Location:** `src/core/services/database-service.ts:41-50`

```ts
export const prisma = new PrismaClient({
  log: ['error', 'warn'],
  datasources: {
    db: {
      url: process.env.DATABASE_URL
        ? `${process.env.DATABASE_URL}${process.env.DATABASE_URL.includes('?') ? '&' : '?'}statement_timeout=120000`
        : undefined,
    },
  },
});
```

**Why This Matters:** You're correctly instantiating a single global PrismaClient that is reused throughout the application. This maintains a single connection pool, preventing connection exhaustion.

**Additional Strength:** You've configured a 120-second statement timeout for long-running operations like holder profile analysis and batch upserts - a pragmatic choice for your workload.

---

### 2. **Comprehensive Schema Design with Proper Indexing**
**Status:** ✅ EXCELLENT
**Evidence:** `prisma/schema.prisma`

**Strengths:**
- ✅ **Foreign Keys with Cascade Deletes:** Properly defined relationships with `onDelete: Cascade` on all dependent models (e.g., `AnalysisResult`, `TokenLot`, `WalletNote`). Prevents orphaned records.

- ✅ **Composite Indexes:** Strategic compound indexes for common query patterns:
  ```ts
  // SwapAnalysisInput
  @@index([walletAddress, timestamp])  // Range + filter queries

  // TokenLot
  @@index([walletAddress, tokenAddress, purchaseTimestamp])  // Multi-dimensional queries

  // HolderProfileSnapshot
  @@index([tokenMint, computedAt])
  @@index([walletAddress, tokenMint, computedAt])
  ```

- ✅ **Composite Unique Constraints:** Properly use unique constraints to prevent duplicates:
  ```ts
  @@unique([walletAddress, tokenAddress])  // AnalysisResult
  @@unique([signature, mint, direction, amount])  // SwapAnalysisInput
  @@unique([walletAddress, list])  // WatchedToken
  ```

- ✅ **PascalCase Models, camelCase Fields:** Proper naming conventions followed throughout.

- ✅ **Enum-like Fixed Values:** Using string fields with `@default()` for status/classification (e.g., `classification`, `status`, `reviewStatus`).

---

### 3. **Proper Type Safety with Prisma Generated Types**
**Status:** ✅ GOOD
**Location:** `src/core/services/database-service.ts:1-100`

```ts
import { PrismaClient, Wallet, SwapAnalysisInput, AnalysisRun, ... } from '@prisma/client';
import { Prisma } from '@prisma/client';

export type SwapAnalysisInputCreateData = Prisma.SwapAnalysisInputCreateInput;
export type WalletUpdateData = Partial<Omit<Wallet, 'address'>>;
```

**Strengths:**
- Using Prisma-generated types instead of manual type duplication
- Deriving custom types from Prisma types (e.g., `Omit<>`, `Partial<>`)
- Exporting types for use across services

---

### 4. **Bulk Operations (createMany, updateMany)**
**Status:** ✅ IMPLEMENTED
**Evidence:** `src/helpers/db/bulk-data-fetcher.ts`, `src/core/services/database-service.ts`

Grep results show `createMany` and `updateMany` are used in multiple places. This is a best practice—Prisma automatically wraps bulk operations in transactions.

---

### 5. **Transaction Support for Atomicity**
**Status:** ✅ IMPLEMENTED
**Evidence:** Grep found 9 files using `prisma.$transaction`

**Good Examples:**
- `src/api/services/credits.service.ts` - Credit system uses transactions to keep CreditBalance and CreditTransaction in sync
- `src/api/services/radar-snapshot.service.ts` - Likely atomic updates for snapshot operations

**Key Pattern from schema comments:**
```ts
// Credit ledger — append-only design
// Never mutate CreditBalance.credits directly; always go through
// CreditsService.topUp() / CreditsService.deduct() which wrap both writes
// in a Prisma transaction to ensure the audit trail is complete.
```

This is **excellent defensive documentation** showing transaction awareness.

---

### 6. **Logging Configuration**
**Status:** ✅ APPROPRIATE
**Location:** `src/core/services/database-service.ts:42`

```ts
log: ['error', 'warn'],
```

Only logging errors and warnings in production to avoid noise—good practice.

---

### 7. **Parameterized Queries**
**Status:** ✅ EXCELLENT (By Default)
**Reason:** Prisma uses parameterized queries by default. All variable interpolation goes through Prisma's type-safe API, preventing SQL injection.

---

## ⚠️ OPPORTUNITIES & UNDERUTILIZED PATTERNS

### 1. **No `select` / `omit` Usage for Sensitive Data**
**Status:** ⚠️ UNDERUTILIZED
**Finding:** No evidence of using `select` or `omit` to exclude sensitive fields from API responses.

**Concern:** Sensitive fields like `passwordHash`, `keyHash`, `token`, etc. in User-related models could be inadvertently returned via REST endpoints.

**Best Practice Example:**
```ts
// Instead of:
const user = await prisma.user.findUnique({ where: { id: userId } });

// Use:
const user = await prisma.user.findUnique({
  where: { id: userId },
  select: {
    id: true,
    displayName: true,
    email: true,
    // passwordHash, apiKey are NOT selected
  },
});
```

**Recommendation:**
- Create reusable `.select` / `.omit` configurations for models with sensitive fields
- Document which fields are safe to return in API responses
- Audit API controllers to ensure sensitive fields aren't returned

**Affected Models:**
- `User` (passwordHash, lastBulkImportAt)
- `ApiKey` (keyHash, prefix)
- `EmailVerificationToken`, `PasswordResetToken` (tokens)
- `PaymentIntent` (txSignature, reference)

---

### 2. **Pagination Strategy Not Fully Visible**
**Status:** ⚠️ PARTIALLY IMPLEMENTED
**Finding:** Grep found pagination keywords in components but no centralized pagination service.

**Evidence from Grep:**
- `dashboard/src/components/holder-profiles/SnapshotHistoryModal.tsx`
- `dashboard/src/controllers/jobs.controller.ts`

**Best Practice Guidance:**
- **Offset-based pagination:** Good for small datasets with arbitrary page jumps (e.g., first/last pages of a list). ✅ Appears used in snapshots/jobs.
- **Cursor-based pagination:** Better for large datasets, infinite scroll, real-time data. Would be ideal for token alerts, activity logs, holder profiles.

**Recommendation:**
- Implement cursor-based pagination for large result sets (TokenAlert, AlertNotification, ActivityLog)
- Document pagination strategy per endpoint in API docs
- Consider implementing a `PaginationCursor` helper in the DatabaseService

**Example of potential cursor-based query:**
```ts
const alerts = await prisma.tokenAlert.findMany({
  where: { userId },
  orderBy: { createdAt: 'desc' },
  take: 20,
  skip: cursor ? 1 : 0,  // Skip the cursor itself
  cursor: cursor ? { id: cursor } : undefined,
});
```

---

### 3. **No Visible Input Validation Before Prisma Calls**
**Status:** ⚠️ NEEDS ATTENTION
**Finding:** While `sanitizePrismaInput` is imported, validation coverage is unclear.

**Location:** `src/core/services/database-service.ts:22`
```ts
import { sanitizePrismaInput } from 'core/utils/string-sanitizer';
```

**Best Practice:** Validate and sanitize user input at system boundaries (API endpoints) before passing to Prisma.

**Recommendation:**
- Ensure all string inputs (wallet addresses, token names, etc.) are validated:
  - Wallet addresses: Solana pubkey format validation
  - Token addresses: Mint format validation
  - Free-form text: Length limits, character whitelisting
- Use a validation library like Zod or class-validator in DTOs
- Evidence: DTOs exist (`src/api/shared/dto/`), but verify they're used on all endpoints

---

### 4. **No Visible Performance Monitoring / Query Analytics**
**Status:** ⚠️ MISSING
**Finding:** No evidence of:
- Query execution time tracking
- Slow query logging
- N+1 query detection

**Best Practice:** Monitor query performance in production.

**Recommendation:**
```ts
const prisma = new PrismaClient({
  log: [
    { level: 'warn', emit: 'stdout' },  // Warnings and errors
    { level: 'info', emit: 'event' },   // For external logging service
  ],
});

// Log to external service (Sentry, DataDog, etc.)
prisma.$on('query', (e) => {
  if (e.duration > 1000) {  // Log queries taking > 1 second
    logger.warn(`Slow query (${e.duration}ms): ${e.query}`);
  }
});
```

---

### 5. **Decimal Type Usage (Good, But May Be Underutilized)**
**Status:** ✅ GOOD WHERE USED
**Evidence:** `TokenLot` model correctly uses `Decimal` for financial calculations
```ts
model TokenLot {
  amountBought      Decimal  @db.Decimal(38, 18)
  costBasisSol      Decimal  @db.Decimal(38, 18)
  amountRemaining   Decimal  @db.Decimal(38, 18)
}
```

**However:** Inconsistency exists—some financial fields use `Float`:
- `AnalysisResult.totalAmountIn` (Float)
- `AnalysisResult.totalSolSpent` (Float)
- `WalletPnlSummary.realizedPnl` (Float)

**Risk:** Floating-point arithmetic can introduce rounding errors in financial calculations.

**Recommendation:**
- Audit all financial/monetary fields (PnL, volumes, costs)
- Consider converting `Float` to `Decimal` for precision-critical fields
- Document which fields accept Float vs. Decimal and why

---

### 6. **No Evidence of Testing Database Setup**
**Status:** ⚠️ MISSING
**Finding:** No visible test database configuration or test helpers.

**Best Practice from Docs:**
- Set up a dedicated test database that can be freely reset
- Use `prisma migrate deploy` for test DB setup
- Mock Prisma in unit tests using `jest-mock-extended`

**Recommendation:**
```sh
# In package.json or test setup:
{
  "scripts": {
    "test:db:setup": "DATABASE_URL=$TEST_DATABASE_URL prisma migrate deploy",
    "test:db:reset": "DATABASE_URL=$TEST_DATABASE_URL prisma migrate reset --force",
    "test": "jest"
  }
}
```

---

### 7. **Implicit Relationship Loading (Potential N+1 Issues)**
**Status:** ⚠️ INVESTIGATE
**Finding:** No comprehensive `select` / `omit` strategy visible; risk of N+1 queries if relationships are loaded implicitly.

**Example Risk Pattern:**
```ts
// Potential N+1 risk:
const wallets = await prisma.wallet.findMany();
for (const wallet of wallets) {
  const profile = await prisma.walletBehaviorProfile.findUnique({
    where: { walletAddress: wallet.address }
  });
  // This causes N additional queries!
}

// Should be:
const wallets = await prisma.wallet.findMany({
  include: { behaviorProfile: true }
});
```

**Recommendation:**
- Audit major query patterns for implicit N+1 patterns
- Use `include` for related data or batch with `IN` filters
- Document relationship loading strategy per major endpoint

---

### 8. **Raw SQL Not Visible (Good Default)**
**Status:** ✅ GOOD
**Finding:** No obvious use of `prisma.$queryRaw` or `prisma.$queryRawUnsafe`.

**Implication:** You're avoiding raw SQL, which is correct. If raw SQL becomes necessary (complex aggregations, specific database features), use parameterized `$queryRaw` with tagged templates:
```ts
// ✅ Safe
const users = await prisma.$queryRaw`SELECT * FROM User WHERE id = ${userId}`;

// ❌ Unsafe (never do this)
const users = await prisma.$queryRaw(`SELECT * FROM User WHERE id = ${userId}`);
```

---

### 9. **Multi-File Schema Not Used**
**Status:** ℹ️ INFO (v6.7.0+)
**Finding:** All models are in a single `prisma/schema.prisma` file (867 lines).

**Note:** With Prisma v6.7.0+, you can organize large schemas into multiple files. This is optional and your single-file approach is still clean.

**Consideration:** If schema exceeds 1000+ lines, consider splitting by domain:
```
prisma/
  schema.prisma      # Imports other files
  wallets.prisma     # Wallet, WalletNote, KolProfile
  analysis.prisma    # Analysis*, AdvancedTradeStats
  users.prisma       # User, ApiKey, RegistrationCode, etc.
  alerts.prisma      # TokenAlert, AlertNotification
```

---

### 10. **Environment Configuration in Connection URL**
**Status:** ✅ GOOD
**Location:** `src/core/services/database-service.ts:45-46`

```ts
url: process.env.DATABASE_URL
  ? `${process.env.DATABASE_URL}${process.env.DATABASE_URL.includes('?') ? '&' : '?'}statement_timeout=120000`
  : undefined,
```

**Strength:** Appending statement_timeout dynamically.
**Note:** For production, consider using connection pooling via PgBouncer or native Prisma connection pooling to handle high concurrency better than raw PostgreSQL connections.

---

## 🔒 SECURITY REVIEW

### Strengths:
1. ✅ No hardcoded credentials (using env vars)
2. ✅ Parameterized queries by default
3. ✅ `onDelete: Cascade` prevents orphaned data
4. ✅ Audit trail for credits (transactions)

### Concerns:
1. ⚠️ No visible `select` / `omit` to exclude sensitive fields from API responses
2. ⚠️ `sanitizePrismaInput` imported but coverage unclear
3. ⚠️ Input validation not obviously tied to all DTO usage

---

## 📋 ACTION ITEMS (Priority Order)

### High Priority:
1. **Implement `select` / `omit` for sensitive fields**
   - Add reusable configurations for User, ApiKey, Token models
   - Audit all API controllers that return user/auth data
   - Update DTOs to exclude sensitive fields

2. **Document input validation strategy**
   - Verify all DTO validators are actually enforced on endpoints
   - Add format validators for wallet addresses, token mints, etc.
   - Update DTO usage in controllers

3. **Audit for N+1 query patterns**
   - Search codebase for loops with Prisma calls inside
   - Document `include` / `select` strategy per major endpoint
   - Consider adding logging to detect N+1 at runtime

### Medium Priority:
4. **Implement cursor-based pagination**
   - For large datasets (TokenAlert, AlertNotification, ActivityLog)
   - Add pagination helper to DatabaseService
   - Update API endpoints

5. **Add test database setup**
   - Configure test DATABASE_URL
   - Create migration scripts for test DB
   - Document testing approach in README

6. **Consider Decimal for all financial fields**
   - Audit all PnL, volume, cost, balance fields
   - Plan migration from Float → Decimal where needed
   - Document precision requirements

### Low Priority:
7. **Add query performance monitoring**
   - Implement slow query logging (> 1s threshold)
   - Send metrics to monitoring service
   - Set up alerts for performance degradation

8. **Consider multi-file schema organization**
   - If schema exceeds 1000 lines, split by domain
   - Current single-file approach is still clean at 867 lines

---

## SUMMARY

### Overall Prisma Maturity: **8/10**

**Excellent Aspects:**
- ✅ Single global PrismaClient (correct connection pooling)
- ✅ Comprehensive indexing strategy
- ✅ Proper composite constraints and cascading deletes
- ✅ Type safety with Prisma-generated types
- ✅ Transaction support for critical operations
- ✅ No raw SQL (safe by default)

**Areas for Improvement:**
- ⚠️ Missing `select` / `omit` configurations for sensitive data exposure
- ⚠️ Unclear input validation coverage
- ⚠️ No visible N+1 prevention strategy
- ⚠️ Missing query performance monitoring
- ⚠️ Inconsistent use of Decimal vs. Float for financial fields

**Biggest Quick Win:**
Implement reusable `select` / `omit` configurations for all API responses to prevent accidental sensitive data leaks (User.passwordHash, ApiKey.keyHash, etc.).

---

**Audit completed by:** Claude Code
**Prisma Docs Reference:** https://www.prisma.io/docs/orm/more/best-practices
