# PAY-1c Testing Plan — @RequireCredits Guard & Interceptor

## ✅ Implementation Complete

**Files Created:**
- `src/api/shared/decorators/require-credits.decorator.ts` - Metadata decorator
- `src/api/shared/guards/credit.guard.ts` - Pre-request balance check
- `src/api/shared/interceptors/credit.interceptor.ts` - Post-success credit deduction
- `src/api/modules/credits.module.ts` - Updated to export guard & interceptor
- `src/app.module.ts` - Registered guard & interceptor globally

**TypeScript Compilation:** ✅ Passes cleanly

---

## Pre-Test Setup

### 1. Add to `.env` (if not already present):
```env
FREE_CREDITS_ON_SIGNUP=100
```

### 2. Ensure Database is Ready
The `credit_ledger` migration should already be applied. Verify:
```bash
npx prisma migrate status
```

If needed, regenerate Prisma client:
```bash
npx prisma generate
```

---

## Test Scenarios

### Scenario 1: New User Gets Signup Bonus (Already Wired in PAY-1b)

**Setup:**
1. Create a new user via the registration endpoint

**Expected:**
- User should automatically receive 100 credits (or value of `FREE_CREDITS_ON_SIGNUP`)
- Check via database or API:
  ```sql
  SELECT * FROM "CreditBalance" WHERE "userId" = '<new_user_id>';
  SELECT * FROM "CreditTransaction" WHERE "userId" = '<new_user_id>';
  ```

**Verification:**
- `CreditBalance.credits` should be 100
- `CreditTransaction` should have one row with `delta=100`, `reason='signup_bonus'`

---

### Scenario 2: Endpoint WITHOUT @RequireCredits Decorator

**Setup:**
1. Call any endpoint that does NOT have `@RequireCredits()` decorator
2. Example: `GET /wallets/{address}/summary` (if it doesn't have the decorator yet)

**Expected:**
- Request proceeds normally
- NO credit check or deduction happens
- Guard and interceptor are bypassed

**Verification:**
- Response is successful (200/404/etc. depending on data)
- User's credit balance remains unchanged

---

### Scenario 3: Endpoint WITH @RequireCredits - Sufficient Balance

**Test Endpoint:** Add decorator to a test endpoint (suggestion: create a dummy endpoint for testing)

```typescript
// Example addition to wallets.controller.ts or create a test controller
@Get('test-credits')
@RequireCredits(5)
async testCredits() {
  return { message: 'Success! Credits were checked and will be deducted.' };
}
```

**Setup:**
1. Ensure user has at least 5 credits (signup bonus gives 100)
2. Call the test endpoint: `GET /api/v1/test-credits`

**Expected:**
- Request succeeds with 200 OK
- Response body: `{ "message": "Success! Credits were checked and will be deducted." }`
- Credits are deducted AFTER response is sent (async, may take a moment)

**Verification:**
1. Check balance immediately after request:
   ```sql
   SELECT * FROM "CreditBalance" WHERE "userId" = '<user_id>';
   ```
   - Credits should be reduced by 5 (100 → 95)

2. Check transaction log:
   ```sql
   SELECT * FROM "CreditTransaction"
   WHERE "userId" = '<user_id>'
   ORDER BY "createdAt" DESC
   LIMIT 1;
   ```
   - Should show `delta=-5`, `reason='endpoint:WalletsController.testCredits'`, `balanceAfter=95`

---

### Scenario 4: Endpoint WITH @RequireCredits - Insufficient Balance

**Setup:**
1. Manually set user's balance to 3 credits (less than required 5):
   ```sql
   UPDATE "CreditBalance" SET "credits" = 3 WHERE "userId" = '<user_id>';
   ```

2. Call the same test endpoint: `GET /api/v1/test-credits`

**Expected:**
- Request is BLOCKED by CreditGuard
- HTTP 402 Payment Required response
- Response body:
  ```json
  {
    "error": "insufficient_credits",
    "balance": 3,
    "required": 5
  }
  ```

**Verification:**
- Credits are NOT deducted (balance remains 3)
- No new transaction in `CreditTransaction` table
- Endpoint handler is NEVER executed (guard blocks before handler)

---

### Scenario 5: Failed Request Does NOT Consume Credits

**Setup:**
1. Ensure user has sufficient credits (e.g., 100)
2. Call an endpoint that will FAIL (e.g., 404 or 500 error)
   - Option A: Call test endpoint with invalid data to trigger validation error
   - Option B: Temporarily modify handler to throw an error

**Expected:**
- Request fails with appropriate error (404/400/500)
- Credits are NOT deducted (interceptor only deducts on success)

**Verification:**
```sql
SELECT * FROM "CreditBalance" WHERE "userId" = '<user_id>';
```
- Balance should remain unchanged
- No new deduction transaction in `CreditTransaction`

---

### Scenario 6: Concurrent Requests (Race Condition Test)

**Setup:**
1. Set user's balance to exactly 5 credits
2. Send TWO simultaneous requests to the test endpoint (5 credits each)

**Expected (Pessimistic Locking):**
- First request: Succeeds (5 → 0)
- Second request: Fails with 402 (insufficient credits)

**Verification:**
- Final balance should be 0 (not negative)
- Only ONE successful deduction transaction
- One request got 200, the other got 402

**How to Test:**
```bash
# Send two requests at the same time
curl -H "Authorization: Bearer <token>" http://localhost:3001/api/v1/test-credits &
curl -H "Authorization: Bearer <token>" http://localhost:3001/api/v1/test-credits &
```

---

## Manual Testing Checklist

Before moving to PAY-1d (decorating real endpoints), verify:

- [ ] Signup bonus grants 100 credits automatically
- [ ] Endpoints without decorator work normally (no credit check)
- [ ] Endpoint with decorator succeeds when balance is sufficient
- [ ] Credits are deducted AFTER successful response
- [ ] Transaction log records correct `reason` (endpoint name)
- [ ] Endpoint blocks with HTTP 402 when balance is insufficient
- [ ] 402 response includes correct error structure
- [ ] Failed requests do NOT consume credits
- [ ] Concurrent requests don't cause negative balance

---

## Integration Testing (Optional)

If you have integration tests set up:

```typescript
describe('CreditGuard', () => {
  it('should block requests with insufficient credits', async () => {
    // Set balance to 0
    // Call endpoint requiring 5 credits
    // Expect 402 response
  });

  it('should deduct credits after successful request', async () => {
    // Set balance to 100
    // Call endpoint requiring 5 credits
    // Expect 200 response
    // Check balance is now 95
  });

  it('should not deduct credits on failed request', async () => {
    // Set balance to 100
    // Call endpoint that throws error
    // Expect error response
    // Check balance is still 100
  });
});
```

---

## Next Steps After Testing

Once all scenarios pass:

1. **PAY-1d:** Decorate real endpoints with credit costs
   - `@RequireCredits(5)` on `/wallets/{address}/behavior-analysis`
   - `@RequireCredits(10)` on dashboard analysis (flash)
   - `@RequireCredits(25)` on dashboard analysis (working)
   - `@RequireCredits(50)` on dashboard analysis (deep)
   - `@RequireCredits(100)` on similarity analysis (base)

2. **Update CONTEXT.md:** Mark PAY-1c as complete

3. **Commit & Push:**
   ```bash
   git add .
   git commit -m "feat(credits): implement @RequireCredits guard and interceptor (PAY-1c)"
   git push analyzer feat/credit-ledger-foundation
   ```

---

## Troubleshooting

### "Property 'creditBalance' does not exist on PrismaClient"
**Solution:** Run `npx prisma generate` to regenerate the Prisma client

### Credits not being deducted
**Check:**
1. Interceptor is registered globally in `app.module.ts`
2. Request is successful (200 response, not error)
3. Check server logs for deduction confirmation
4. Deduction is async — may take a moment to appear in DB

### 402 not being returned
**Check:**
1. Guard is registered globally in `app.module.ts`
2. User is authenticated (guard requires `request.user`)
3. Endpoint has `@RequireCredits()` decorator
4. Prisma client is up to date

### Balance goes negative
**Should not happen** — guard uses `$transaction` with lock-and-read
**If it does:** Report as a bug, this indicates a race condition

---

## Summary

The credit system is now fully operational:

✅ Database schema (PAY-1a)
✅ CreditsService (PAY-1b)
✅ Signup bonus (PAY-1b)
✅ @RequireCredits decorator (PAY-1c)
✅ CreditGuard — pre-check (PAY-1c)
✅ CreditInterceptor — post-deduct (PAY-1c)

**Ready for testing!**
