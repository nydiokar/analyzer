# API Key Service Architecture Issues & Resolution Plan

**Status**: Critical architecture refactor needed - violates Single Responsibility Principle

**Date**: December 2025

## The Problem: Architectural Debt in API Key Services

### Current Architecture Issues

#### 1. **Single Responsibility Principle Violation**
The `JwtDatabaseService` currently handles **unrelated responsibilities**:

```typescript
@Injectable()
export class JwtDatabaseService {
  // ✅ JWT & Authentication (belongs here)
  async findUserByEmail(email: string)
  async createUserWithJWT(userData)
  async updateUserLastLogin(userId: string)

  // ✅ Email Verification (belongs here)
  async createVerificationToken(userId, token, expiresAt)
  async findValidVerificationToken(userId, token)

  // ✅ Password Reset (belongs here)
  async createPasswordResetToken(userId, hashedToken, expiresAt)
  async findValidPasswordResetToken(userId, hashedToken)

  // ❌ API Keys (DOES NOT BELONG HERE)
  async createApiKey(data)           // ← PROBLEM
  async findApiKeyByPrefix(prefix)    // ← PROBLEM
  async findAllApiKeysWithUsers()     // ← PROBLEM
  async deleteApiKeyById(keyId)       // ← PROBLEM
}
```

**Why this is wrong**: API keys have **zero relationship** to JWT functionality. They serve different purposes:
- JWT: Human user authentication sessions
- API Keys: Service-to-service authentication for external integrations

#### 2. **Inconsistent Data Access Patterns**
The codebase mixes two approaches:

```typescript
// ❌ Direct Prisma access (breaks abstraction)
const keys = await (this.databaseService as any).prismaClient.apiKey.findMany({...})

// ✅ Proper service abstraction
const keys = await this.databaseService.findApiKeysByUserId(userId)
```

#### 3. **Business Logic Scattered Across Layers**
`ApiKeyService` should handle all API key business logic, but some leaks into the database layer:

```typescript
// ApiKeyService.validateApiKey() - ✅ Business logic here
async validateApiKey(apiKey: string): Promise<ApiKeyValidationResult> {
  const prefix = this.extractPrefix(apiKey);        // Business logic
  const keyRecord = await this.databaseService.findApiKeyByPrefix(prefix);
  // ... validation logic ...
}

// JwtDatabaseService.findApiKeyByPrefix() - ❌ Should be pure data access
async findApiKeyByPrefix(prefix: string): Promise<any> {
  // This should only query data, not handle JSON parsing logic
  if (key && key.scopes) {
    key.scopes = JSON.parse(key.scopes); // ← Business logic in data layer!
  }
}
```

#### 4. **Confusing Service Dependencies**
The `AdminModule` currently injects services with unclear responsibilities:

```typescript
@Module({
  providers: [
    ApiKeyService,           // Business logic
    JwtDatabaseService,      // JWT + User + API Keys (confusing!)
  ],
})
```

## The Solution: Domain-Driven Separation

### Proposed Clean Architecture

```
src/api/shared/services/
├── jwt-database.service.ts        # JWT + User auth operations
├── api-key-database.service.ts    # NEW: Pure API key data access
└── api-key.service.ts             # API key business logic
```

### Step 1: Create ApiKeyDatabaseService

```typescript
// src/api/shared/services/api-key-database.service.ts
@Injectable()
export class ApiKeyDatabaseService {
  constructor(private readonly databaseService: DatabaseService) {}

  // Pure data access - no business logic
  async createApiKey(data: {
    prefix: string;
    keyHash: string;
    userId: string;
    description: string;
    scopes: string[];
    isActive: boolean;
    expiresAt?: Date;
  }): Promise<any> {
    return await this.databaseService.prismaClient.apiKey.create({
      data: {
        ...data,
        scopes: JSON.stringify(data.scopes),
      },
    });
  }

  async findApiKeyByPrefix(prefix: string): Promise<any> {
    const key = await this.databaseService.prismaClient.apiKey.findFirst({
      where: { prefix },
    });
    return key ? { ...key, scopes: JSON.parse(key.scopes || '[]') } : null;
  }

  async findApiKeyById(keyId: string): Promise<any> {
    const key = await this.databaseService.prismaClient.apiKey.findUnique({
      where: { id: keyId },
    });
    return key ? { ...key, scopes: JSON.parse(key.scopes || '[]') } : null;
  }

  async findApiKeysByUserId(userId: string): Promise<any[]> {
    const keys = await this.databaseService.prismaClient.apiKey.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return keys.map(key => ({
      ...key,
      scopes: JSON.parse(key.scopes || '[]'),
    }));
  }

  async findAllApiKeysWithUsers(): Promise<any[]> {
    const keys = await this.databaseService.prismaClient.apiKey.findMany({
      include: {
        user: {
          select: { email: true, description: true }
        }
      },
      orderBy: { createdAt: 'desc' },
    });
    return keys.map(key => ({
      ...key,
      scopes: JSON.parse(key.scopes || '[]'),
    }));
  }

  async updateApiKeyLastUsed(keyId: string): Promise<void> {
    await this.databaseService.prismaClient.apiKey.update({
      where: { id: keyId },
      data: { lastUsedAt: new Date() },
    });
  }

  async updateApiKeyStatus(keyId: string, isActive: boolean): Promise<void> {
    await this.databaseService.prismaClient.apiKey.update({
      where: { id: keyId },
      data: { isActive },
    });
  }

  async updateApiKeyMetadata(
    keyId: string,
    updates: { description?: string; scopes?: string[] }
  ): Promise<void> {
    const updateData: any = {};
    if (updates.description !== undefined) {
      updateData.description = updates.description;
    }
    if (updates.scopes !== undefined) {
      updateData.scopes = JSON.stringify(updates.scopes);
    }

    await this.databaseService.prismaClient.apiKey.update({
      where: { id: keyId },
      data: updateData,
    });
  }

  async deleteApiKeyById(keyId: string): Promise<any> {
    return await this.databaseService.prismaClient.apiKey.delete({
      where: { id: keyId },
    });
  }

  async deleteExpiredApiKeys(): Promise<number> {
    const result = await this.databaseService.prismaClient.apiKey.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });
    return result.count;
  }
}
```

### Step 2: Clean Up JwtDatabaseService

**Remove all API key methods** - keep only JWT/user auth related:

```typescript
@Injectable()
export class JwtDatabaseService {
  // ✅ Keep: User management
  async findUserByEmail(email: string)
  async createUserWithJWT(userData)
  async updateUserLastLogin(userId: string)

  // ✅ Keep: Email verification
  async createVerificationToken(userId, token, expiresAt)
  async findValidVerificationToken(userId, token)

  // ✅ Keep: Password reset
  async createPasswordResetToken(userId, hashedToken, expiresAt)
  async findValidPasswordResetToken(userId, hashedToken)

  // ❌ Remove: ALL API key methods moved to ApiKeyDatabaseService
}
```

### Step 3: Update ApiKeyService

```typescript
@Injectable()
export class ApiKeyService {
  constructor(
    private readonly apiKeyDatabaseService: ApiKeyDatabaseService, // NEW
    private readonly jwtDatabaseService: JwtDatabaseService,       // Keep for user lookups only
    private readonly configService: ConfigService,
  ) {}

  // Update all methods to use apiKeyDatabaseService
  async createApiKey(request: CreateApiKeyRequest) {
    // ... business logic stays the same ...
    const keyRecord = await this.apiKeyDatabaseService.createApiKey({...});
    // ... rest of method ...
  }

  async validateApiKey(apiKey: string) {
    // ... business logic stays the same ...
    const keyRecord = await this.apiKeyDatabaseService.findApiKeyByPrefix(prefix);
    const user = await this.jwtDatabaseService.findActiveUserById(keyRecord.userId); // Keep for user lookup
    // ... rest of method ...
  }

  async listUserApiKeys(userId: string) {
    return await this.apiKeyDatabaseService.findApiKeysByUserId(userId);
  }

  // Admin methods
  async listAllApiKeys() {
    return await this.apiKeyDatabaseService.findAllApiKeysWithUsers();
  }

  async deleteApiKey(keyId: string) {
    // ... business logic stays the same ...
    const deletedKey = await this.apiKeyDatabaseService.deleteApiKeyById(keyId);
    // ... rest of method ...
  }
}
```

### Step 4: Update AdminModule

```typescript
@Module({
  imports: [DatabaseModule, ConfigModule],
  controllers: [AdminController],
  providers: [
    ApiKeyService,           // Business logic (uses ApiKeyDatabaseService)
    ApiKeyDatabaseService,   // NEW: Pure API key data access
    JwtDatabaseService,      // Keep for any user operations
  ],
})
export class AdminModule {}
```

## Benefits of This Refactor

### ✅ **Single Responsibility Principle**
- `JwtDatabaseService`: Pure JWT/user authentication data access
- `ApiKeyDatabaseService`: Pure API key data access
- `ApiKeyService`: API key business logic orchestration

### ✅ **Clear Separation of Concerns**
- **Data Layer**: Pure database queries (no business logic)
- **Business Layer**: Validation, transformation, security logic
- **Presentation Layer**: Controllers handle HTTP concerns

### ✅ **Consistent Abstraction**
- All data access goes through dedicated database services
- No more direct Prisma access in business logic
- Uniform error handling and logging

### ✅ **Maintainable & Testable**
- Each service has focused responsibilities
- Easy to mock database services for unit testing
- Changes to one domain don't affect others

### ✅ **Domain-Driven Design**
- Related functionality grouped together
- Clear boundaries between authentication domains

## Implementation Priority

### Phase 1: Create New Service (Low Risk)
1. Create `ApiKeyDatabaseService`
2. Move API key methods from `JwtDatabaseService`
3. Update `ApiKeyService` to use new service
4. Update `AdminModule` providers

### Phase 2: Clean Up (Medium Risk)
1. Remove API key methods from `JwtDatabaseService`
2. Update any remaining imports/references
3. Test all API key functionality

### Phase 3: Verify (Low Risk)
1. Run full test suite
2. Verify admin endpoints work
3. Verify user API key operations work
4. Check for any missed references

## Risk Assessment

- **Low Risk**: Creating new service doesn't break existing functionality
- **Medium Risk**: Removing methods from `JwtDatabaseService` (but they're unused after Phase 1)
- **Testing Required**: Full integration testing of all API key endpoints

## Success Criteria

✅ All API key operations work (create, list, revoke, update, delete)
✅ No direct Prisma access in business logic layers
✅ Clear service responsibilities and dependencies
✅ Consistent data access patterns
✅ All existing functionality preserved
✅ Easy to add new API key features without affecting auth

---

**Next Steps**: This refactor should be implemented before adding any new API key features to prevent architectural debt accumulation.
