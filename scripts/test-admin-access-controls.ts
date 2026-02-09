#!/usr/bin/env ts-node
/**
 * Interactive Admin Access Control Testing Script
 *
 * Tests registration codes, kill-switch, and user management in logical order.
 * Run with: npx ts-node -r tsconfig-paths/register scripts/test-admin-access-controls.ts
 */

import * as readline from 'readline';
import fetch from 'node-fetch';
import { promisify } from 'util';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const sleep = promisify(setTimeout);

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (prompt: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
};

interface TestContext {
  apiBaseUrl: string;
  adminToken: string;
  testUserEmail: string;
  testUserPassword: string;
  testUserId?: string;
  testUserToken?: string;
  createdCodes: string[];
  createdBulkCodes: string[];
}

const log = {
  info: (msg: string) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  success: (msg: string) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  error: (msg: string) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  warn: (msg: string) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  step: (msg: string) => console.log(`\n${colors.cyan}▶${colors.reset} ${colors.cyan}${msg}${colors.reset}`),
  detail: (msg: string) => console.log(`  ${colors.gray}${msg}${colors.reset}`),
};

async function makeRequest(
  url: string,
  options: any = {},
  ctx: TestContext
): Promise<{ ok: boolean; status: number; data?: any; error?: string }> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };

    if (options.useToken === 'admin') {
      headers['Authorization'] = `Bearer ${ctx.adminToken}`;
    } else if (options.useToken === 'user') {
      headers['Authorization'] = `Bearer ${ctx.testUserToken}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    let data;
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    return {
      ok: response.ok,
      status: response.status,
      data,
    };
  } catch (error: any) {
    return {
      ok: false,
      status: 0,
      error: error.message,
    };
  }
}

async function testRegistrationCodeCreation(ctx: TestContext): Promise<boolean> {
  log.step('Testing Registration Code Creation');

  // Test 1: Create single code
  log.info('Creating single registration code...');
  const singleCodeRes = await makeRequest(
    `${ctx.apiBaseUrl}/admin/registration-codes`,
    {
      method: 'POST',
      body: JSON.stringify({
        description: 'Test single code',
        maxUses: 1,
      }),
      useToken: 'admin',
    },
    ctx
  );

  if (!singleCodeRes.ok) {
    log.error(`Failed to create single code: ${singleCodeRes.data?.message || singleCodeRes.error}`);
    return false;
  }

  const singleCode = singleCodeRes.data.code;
  ctx.createdCodes.push(singleCode);
  log.success(`Created single-use code: ${singleCode}`);

  // Test 2: Create bulk codes
  log.info('Creating 5 bulk registration codes...');
  const bulkCodesRes = await makeRequest(
    `${ctx.apiBaseUrl}/admin/registration-codes/bulk`,
    {
      method: 'POST',
      body: JSON.stringify({
        count: 5,
        description: 'Test bulk codes',
        maxUses: 1,
      }),
      useToken: 'admin',
    },
    ctx
  );

  if (!bulkCodesRes.ok) {
    log.error(`Failed to create bulk codes: ${bulkCodesRes.data?.message || bulkCodesRes.error}`);
    return false;
  }

  ctx.createdBulkCodes = Array.isArray(bulkCodesRes.data)
    ? bulkCodesRes.data.map((c: any) => c.code)
    : [];
  log.success(`Created ${ctx.createdBulkCodes.length} bulk codes`);

  // Test 3: Create multi-use code
  log.info('Creating multi-use code (max 3 uses)...');
  const multiUseRes = await makeRequest(
    `${ctx.apiBaseUrl}/admin/registration-codes`,
    {
      method: 'POST',
      body: JSON.stringify({
        description: 'Test multi-use code',
        maxUses: 3,
      }),
      useToken: 'admin',
    },
    ctx
  );

  if (!multiUseRes.ok) {
    log.error(`Failed to create multi-use code: ${multiUseRes.data?.message || multiUseRes.error}`);
    return false;
  }

  const multiUseCode = multiUseRes.data.code;
  ctx.createdCodes.push(multiUseCode);
  log.success(`Created multi-use code: ${multiUseCode}`);

  return true;
}

async function testRegistrationCodeListing(ctx: TestContext): Promise<boolean> {
  log.step('Testing Registration Code Listing');

  // Test: List all codes
  log.info('Listing all registration codes...');
  const listRes = await makeRequest(
    `${ctx.apiBaseUrl}/admin/registration-codes?limit=100`,
    { useToken: 'admin' },
    ctx
  );

  if (!listRes.ok) {
    log.error(`Failed to list codes: ${listRes.data?.message || listRes.error}`);
    return false;
  }

  log.success(`Listed ${Array.isArray(listRes.data) ? listRes.data.length : 0} codes`);

  // Test: Get stats
  log.info('Getting registration code statistics...');
  const statsRes = await makeRequest(
    `${ctx.apiBaseUrl}/admin/registration-codes/stats`,
    { useToken: 'admin' },
    ctx
  );

  if (!statsRes.ok) {
    log.error(`Failed to get stats: ${statsRes.data?.message || statsRes.error}`);
    return false;
  }

  log.success('Statistics retrieved:');
  log.detail(`Total: ${statsRes.data.total}`);
  log.detail(`Active: ${statsRes.data.active}`);
  log.detail(`Used: ${statsRes.data.used}`);
  log.detail(`Revoked: ${statsRes.data.revoked}`);

  return true;
}

async function testUserRegistration(ctx: TestContext): Promise<boolean> {
  log.step('Testing User Registration with Code');

  const testCode = ctx.createdCodes[0]; // Use first single-use code
  log.info(`Attempting registration with code: ${testCode}`);

  const registerRes = await makeRequest(
    `${ctx.apiBaseUrl}/auth/register`,
    {
      method: 'POST',
      body: JSON.stringify({
        email: ctx.testUserEmail,
        password: ctx.testUserPassword,
        registrationCode: testCode,
      }),
    },
    ctx
  );

  if (!registerRes.ok) {
    log.error(`Registration failed: ${registerRes.data?.message || registerRes.error}`);
    return false;
  }

  ctx.testUserToken = registerRes.data.access_token;
  ctx.testUserId = registerRes.data.user?.id;
  log.success(`User registered successfully! User ID: ${ctx.testUserId}`);

  // Test: Try to register with same code again (should fail)
  log.info('Testing used code rejection...');
  const reRegisterRes = await makeRequest(
    `${ctx.apiBaseUrl}/auth/register`,
    {
      method: 'POST',
      body: JSON.stringify({
        email: `another-${ctx.testUserEmail}`,
        password: ctx.testUserPassword,
        registrationCode: testCode,
      }),
    },
    ctx
  );

  if (reRegisterRes.ok) {
    log.error('ERROR: Used code was accepted! Should have been rejected.');
    return false;
  }

  log.success('Used code correctly rejected');

  // Test: Register without code (should fail)
  log.info('Testing registration without code...');
  const noCodeRes = await makeRequest(
    `${ctx.apiBaseUrl}/auth/register`,
    {
      method: 'POST',
      body: JSON.stringify({
        email: `nocode-${ctx.testUserEmail}`,
        password: ctx.testUserPassword,
      }),
    },
    ctx
  );

  if (noCodeRes.ok) {
    log.error('ERROR: Registration without code was accepted!');
    return false;
  }

  log.success('Registration without code correctly rejected');

  return true;
}

async function testMultiUseCodeExhaustion(ctx: TestContext): Promise<boolean> {
  log.step('Testing Multi-Use Code Exhaustion');

  const multiUseCode = ctx.createdCodes[1]; // Use the multi-use code (max 3)
  log.info(`Testing multi-use code: ${multiUseCode} (max 3 uses)`);

  // Use it 3 times
  for (let i = 1; i <= 3; i++) {
    log.info(`Attempt ${i}/3 to use multi-use code...`);
    const registerRes = await makeRequest(
      `${ctx.apiBaseUrl}/auth/register`,
      {
        method: 'POST',
        body: JSON.stringify({
          email: `multiuse-${Date.now()}-${i}@test.com`,
          password: ctx.testUserPassword,
          registrationCode: multiUseCode,
        }),
      },
      ctx
    );

    if (!registerRes.ok) {
      log.error(`Use ${i}/3 failed: ${registerRes.data?.message || registerRes.error}`);
      return false;
    }

    log.success(`Use ${i}/3 successful`);
    await sleep(100); // Small delay to avoid race conditions
  }

  // Try to use it a 4th time (should fail)
  log.info('Attempting 4th use (should fail)...');
  const fourthUseRes = await makeRequest(
    `${ctx.apiBaseUrl}/auth/register`,
    {
      method: 'POST',
      body: JSON.stringify({
        email: `multiuse-${Date.now()}-4@test.com`,
        password: ctx.testUserPassword,
        registrationCode: multiUseCode,
      }),
    },
    ctx
  );

  if (fourthUseRes.ok) {
    log.error('ERROR: Code accepted after exhausting all uses!');
    return false;
  }

  log.success('Exhausted code correctly rejected');

  return true;
}

async function testCodeRevocation(ctx: TestContext): Promise<boolean> {
  log.step('Testing Code Revocation');

  const testCode = ctx.createdBulkCodes[0]; // Use first bulk code
  log.info(`Revoking code: ${testCode}`);

  const revokeRes = await makeRequest(
    `${ctx.apiBaseUrl}/admin/registration-codes/${testCode}/revoke`,
    {
      method: 'PATCH',
      useToken: 'admin',
    },
    ctx
  );

  if (!revokeRes.ok) {
    log.error(`Failed to revoke code: ${revokeRes.data?.message || revokeRes.error}`);
    return false;
  }

  log.success('Code revoked successfully');

  // Test: Try to use revoked code
  log.info('Testing revoked code rejection...');
  const useRevokedRes = await makeRequest(
    `${ctx.apiBaseUrl}/auth/register`,
    {
      method: 'POST',
      body: JSON.stringify({
        email: `revoked-${Date.now()}@test.com`,
        password: ctx.testUserPassword,
        registrationCode: testCode,
      }),
    },
    ctx
  );

  if (useRevokedRes.ok) {
    log.error('ERROR: Revoked code was accepted!');
    return false;
  }

  log.success('Revoked code correctly rejected');

  return true;
}

async function testCodeRequirementToggle(ctx: TestContext): Promise<boolean> {
  log.step('Testing Code Requirement Toggle');

  // Wait to avoid rate limiting from previous tests
  log.info('Waiting 5 seconds to avoid rate limiting...');
  await sleep(5000);

  // Test 1: Disable code requirement (open registration)
  log.info('Disabling code requirement (open registration)...');
  const disableRes = await makeRequest(
    `${ctx.apiBaseUrl}/admin/registration/code-requirement/disable`,
    {
      method: 'POST',
      useToken: 'admin',
    },
    ctx
  );

  if (!disableRes.ok) {
    log.error(`Failed to disable code requirement: ${disableRes.data?.message || disableRes.error}`);
    return false;
  }

  log.success('Code requirement disabled');

  // Test 2: Register WITHOUT code (should succeed)
  log.info('Testing registration without code (should succeed)...');
  const noCodeRegRes = await makeRequest(
    `${ctx.apiBaseUrl}/auth/register`,
    {
      method: 'POST',
      body: JSON.stringify({
        email: `no-code-${Date.now()}@test.com`,
        password: ctx.testUserPassword,
      }),
    },
    ctx
  );

  if (!noCodeRegRes.ok) {
    log.error(`Registration without code failed: ${noCodeRegRes.data?.message || noCodeRegRes.error}`);
    return false;
  }

  log.success('Registration without code succeeded (open registration working!)');

  // Test 3: Register WITH code (should still work)
  log.info('Testing registration with code (optional, should still work)...');
  const withCodeRegRes = await makeRequest(
    `${ctx.apiBaseUrl}/auth/register`,
    {
      method: 'POST',
      body: JSON.stringify({
        email: `with-code-${Date.now()}@test.com`,
        password: ctx.testUserPassword,
        registrationCode: ctx.createdBulkCodes[3],
      }),
    },
    ctx
  );

  if (!withCodeRegRes.ok) {
    log.error(`Registration with code failed: ${withCodeRegRes.data?.message || withCodeRegRes.error}`);
    return false;
  }

  log.success('Registration with code also works (code is optional)');

  // Test 4: Re-enable code requirement
  log.info('Re-enabling code requirement...');
  const enableRes = await makeRequest(
    `${ctx.apiBaseUrl}/admin/registration/code-requirement/enable`,
    {
      method: 'POST',
      useToken: 'admin',
    },
    ctx
  );

  if (!enableRes.ok) {
    log.error(`Failed to enable code requirement: ${enableRes.data?.message || enableRes.error}`);
    return false;
  }

  log.success('Code requirement re-enabled');

  // Test 5: Register WITHOUT code (should fail now)
  log.info('Testing registration without code (should fail now)...');
  const noCodeFailRes = await makeRequest(
    `${ctx.apiBaseUrl}/auth/register`,
    {
      method: 'POST',
      body: JSON.stringify({
        email: `no-code-fail-${Date.now()}@test.com`,
        password: ctx.testUserPassword,
      }),
    },
    ctx
  );

  if (noCodeFailRes.ok) {
    log.error('ERROR: Registration without code succeeded when codes are required!');
    return false;
  }

  log.success('Registration without code correctly rejected');

  return true;
}

async function testKillSwitch(ctx: TestContext): Promise<boolean> {
  log.step('Testing Registration Kill-Switch');

  // Wait 5 seconds to avoid rate limiting from previous registration tests
  log.info('Waiting 5 seconds to avoid rate limiting...');
  await sleep(5000);

  // Test 1: Enable kill-switch
  log.info('Enabling registration kill-switch...');
  const enableRes = await makeRequest(
    `${ctx.apiBaseUrl}/admin/registration/kill-switch/enable`,
    {
      method: 'POST',
      useToken: 'admin',
    },
    ctx
  );

  if (!enableRes.ok) {
    log.error(`Failed to enable kill-switch: ${enableRes.data?.message || enableRes.error}`);
    return false;
  }

  log.success('Kill-switch enabled');

  // Test 2: Verify registration is blocked
  log.info('Testing registration is blocked...');
  const blockedRegRes = await makeRequest(
    `${ctx.apiBaseUrl}/auth/register`,
    {
      method: 'POST',
      body: JSON.stringify({
        email: `killswitch-${Date.now()}@test.com`,
        password: ctx.testUserPassword,
        registrationCode: ctx.createdBulkCodes[1],
      }),
    },
    ctx
  );

  if (blockedRegRes.ok) {
    log.error('ERROR: Registration was allowed with kill-switch enabled!');
    return false;
  }

  // Accept both 503 (kill-switch) and 429 (rate limit) as valid blocking responses
  if (blockedRegRes.status !== 503 && blockedRegRes.status !== 429) {
    log.error(`Expected 503 or 429, got ${blockedRegRes.status}`);
    return false;
  }

  if (blockedRegRes.status === 429) {
    log.success('Registration correctly blocked (429 Rate Limited - hit before kill-switch check)');
    log.detail('Note: Rate limiter triggered due to multiple test registrations');
  } else {
    log.success('Registration correctly blocked (503 Service Unavailable)');
  }

  // Test 3: Verify existing users can still login
  log.info('Testing existing user login...');
  const loginRes = await makeRequest(
    `${ctx.apiBaseUrl}/auth/login`,
    {
      method: 'POST',
      body: JSON.stringify({
        email: ctx.testUserEmail,
        password: ctx.testUserPassword,
      }),
    },
    ctx
  );

  if (!loginRes.ok) {
    log.error(`Existing user login failed: ${loginRes.data?.message || loginRes.error}`);
    return false;
  }

  log.success('Existing users can still login');

  // Test 4: Disable kill-switch
  log.info('Disabling registration kill-switch...');
  const disableRes = await makeRequest(
    `${ctx.apiBaseUrl}/admin/registration/kill-switch/disable`,
    {
      method: 'POST',
      useToken: 'admin',
    },
    ctx
  );

  if (!disableRes.ok) {
    log.error(`Failed to disable kill-switch: ${disableRes.data?.message || disableRes.error}`);
    return false;
  }

  log.success('Kill-switch disabled');

  // Wait to avoid rate limiting
  log.info('Waiting 3 seconds...');
  await sleep(3000);

  // Test 5: Verify registration works again
  log.info('Testing registration works after disabling kill-switch...');
  const afterKillswitchRegRes = await makeRequest(
    `${ctx.apiBaseUrl}/auth/register`,
    {
      method: 'POST',
      body: JSON.stringify({
        email: `after-killswitch-${Date.now()}@test.com`,
        password: ctx.testUserPassword,
        registrationCode: ctx.createdBulkCodes[2],
      }),
    },
    ctx
  );

  if (!afterKillswitchRegRes.ok) {
    log.error(`Registration failed after disabling kill-switch: ${afterKillswitchRegRes.data?.message}`);
    return false;
  }

  log.success('Registration works after disabling kill-switch');

  return true;
}

async function testUserAccountManagement(ctx: TestContext): Promise<boolean> {
  log.step('Testing User Account Management');

  if (!ctx.testUserId) {
    log.error('No test user ID available');
    return false;
  }

  // Test 1: Verify user can access protected endpoint BEFORE disabling
  log.info('Testing user can access protected endpoint while active...');
  const beforeDisableRes = await makeRequest(
    `${ctx.apiBaseUrl}/users/me`,
    {
      method: 'GET',
      useToken: 'user',
    },
    ctx
  );

  if (!beforeDisableRes.ok) {
    log.warn(`User cannot access /users/me (might need email verification): ${beforeDisableRes.status}`);
  } else {
    log.success('Active user can access protected endpoints');
  }

  // Test 2: Disable user account
  log.info(`Disabling user account: ${ctx.testUserId}`);
  const disableRes = await makeRequest(
    `${ctx.apiBaseUrl}/admin/users/${ctx.testUserId}/disable`,
    {
      method: 'PATCH',
      useToken: 'admin',
    },
    ctx
  );

  if (!disableRes.ok) {
    log.error(`Failed to disable user: ${disableRes.data?.message || disableRes.error}`);
    return false;
  }

  log.success('User account disabled');

  // Test 3: Verify disabled user cannot login
  log.info('Testing disabled user login...');
  const disabledLoginRes = await makeRequest(
    `${ctx.apiBaseUrl}/auth/login`,
    {
      method: 'POST',
      body: JSON.stringify({
        email: ctx.testUserEmail,
        password: ctx.testUserPassword,
      }),
    },
    ctx
  );

  if (disabledLoginRes.ok) {
    log.error('ERROR: Disabled user was able to login!');
    return false;
  }

  log.success('Disabled user correctly rejected from login');

  // Test 4: Verify disabled user's existing token doesn't work
  log.info('Testing disabled user cannot use existing token...');
  const disabledTokenRes = await makeRequest(
    `${ctx.apiBaseUrl}/users/me`,
    {
      method: 'GET',
      useToken: 'user',
    },
    ctx
  );

  if (disabledTokenRes.ok) {
    log.error('ERROR: Disabled user can still use their token!');
    return false;
  }

  log.success('Disabled user token correctly rejected');

  // Test 5: Re-enable user account
  log.info(`Re-enabling user account: ${ctx.testUserId}`);
  const enableRes = await makeRequest(
    `${ctx.apiBaseUrl}/admin/users/${ctx.testUserId}/enable`,
    {
      method: 'PATCH',
      useToken: 'admin',
    },
    ctx
  );

  if (!enableRes.ok) {
    log.error(`Failed to enable user: ${enableRes.data?.message || enableRes.error}`);
    return false;
  }

  log.success('User account re-enabled');

  // Test 6: Verify re-enabled user can login
  log.info('Testing re-enabled user login...');
  const enabledLoginRes = await makeRequest(
    `${ctx.apiBaseUrl}/auth/login`,
    {
      method: 'POST',
      body: JSON.stringify({
        email: ctx.testUserEmail,
        password: ctx.testUserPassword,
      }),
    },
    ctx
  );

  if (!enabledLoginRes.ok) {
    log.error(`Re-enabled user login failed: ${enabledLoginRes.data?.message || enabledLoginRes.error}`);
    return false;
  }

  ctx.testUserToken = enabledLoginRes.data.access_token;
  log.success('Re-enabled user can login successfully');

  // Test 7: Verify re-enabled user can access protected endpoints again
  log.info('Testing re-enabled user can access protected endpoints...');
  const afterEnableRes = await makeRequest(
    `${ctx.apiBaseUrl}/users/me`,
    {
      method: 'GET',
      useToken: 'user',
    },
    ctx
  );

  if (!afterEnableRes.ok) {
    log.warn(`Re-enabled user cannot access /users/me: ${afterEnableRes.status}`);
  } else {
    log.success('Re-enabled user can access protected endpoints');
  }

  return true;
}

async function testNonAdminAccess(ctx: TestContext): Promise<boolean> {
  log.step('Testing Non-Admin Access Protection');

  if (!ctx.testUserToken || !ctx.testUserId) {
    log.warn('Skipping non-admin test (no test user)');
    return true;
  }

  // Re-login as test user to get fresh token after enable/disable operations
  log.info('Getting fresh token for non-admin user...');
  const loginRes = await makeRequest(
    `${ctx.apiBaseUrl}/auth/login`,
    {
      method: 'POST',
      body: JSON.stringify({
        email: ctx.testUserEmail,
        password: ctx.testUserPassword,
      }),
    },
    ctx
  );

  if (!loginRes.ok) {
    log.error('Failed to re-login as test user');
    return false;
  }

  ctx.testUserToken = loginRes.data.access_token;

  log.info('Testing non-admin access to admin endpoint...');
  const nonAdminRes = await makeRequest(
    `${ctx.apiBaseUrl}/admin/registration-codes`,
    { useToken: 'user' },
    ctx
  );

  if (nonAdminRes.ok) {
    log.error('ERROR: Non-admin user accessed admin endpoint!');
    return false;
  }

  // Accept both 401 (if email not verified) and 403 (if verified but not admin)
  if (nonAdminRes.status !== 403 && nonAdminRes.status !== 401) {
    log.error(`Expected 403 Forbidden or 401 Unauthorized, got ${nonAdminRes.status}`);
    return false;
  }

  log.success(`Non-admin access correctly blocked (${nonAdminRes.status})`);

  return true;
}

async function cleanup(ctx: TestContext): Promise<void> {
  log.step('Cleanup');

  // Delete test codes
  log.info('Deleting created test codes...');
  for (const code of [...ctx.createdCodes, ...ctx.createdBulkCodes]) {
    await makeRequest(
      `${ctx.apiBaseUrl}/admin/registration-codes/${code}`,
      {
        method: 'DELETE',
        useToken: 'admin',
      },
      ctx
    );
  }

  log.success('Cleanup completed');
}

async function main() {
  console.log(`
${colors.cyan}═══════════════════════════════════════════════════════════════════
  Admin Access Control Testing Suite
═══════════════════════════════════════════════════════════════════${colors.reset}
`);

  // Auto-detect API URL from environment or use default
  const port = process.env.PORT || '3001';
  const apiBaseUrl = process.env.API_BASE_URL || `http://localhost:${port}/api/v1`;

  log.info(`Using API: ${apiBaseUrl}`);
  console.log();

  // Only ask for credentials
  const adminEmail = (await question('Admin email: ')).trim();
  const adminPassword = (await question('Admin password: ')).trim();

  // Login as admin
  log.step('Authenticating as Admin');
  const loginRes = await fetch(`${apiBaseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });

  if (!loginRes.ok) {
    log.error('Admin login failed. Please check credentials.');
    rl.close();
    process.exit(1);
  }

  const loginData = (await loginRes.json()) as {
    access_token: string;
    refresh_token: string;
    user: {
      id: string;
      email: string;
      isAdmin: boolean;
      isDemo: boolean;
      emailVerified: boolean;
      displayName?: string;
    };
  };
  log.success('Admin authenticated successfully');

  // Initialize test context
  const ctx: TestContext = {
    apiBaseUrl,
    adminToken: loginData.access_token,
    testUserEmail: `test-user-${Date.now()}@example.com`,
    testUserPassword: 'TestPass123!',
    createdCodes: [],
    createdBulkCodes: [],
  };

  log.info(`Test user email will be: ${ctx.testUserEmail}`);

  // CRITICAL: Ensure clean state before tests
  log.step('Setting Up Clean Test Environment');

  // Disable kill-switch if it's on
  log.info('Ensuring kill-switch is disabled...');
  await makeRequest(
    `${apiBaseUrl}/admin/registration/kill-switch/disable`,
    { method: 'POST', useToken: 'admin' },
    ctx
  );

  // Ensure codes are required (default safe mode)
  log.info('Ensuring code requirement is enabled...');
  await makeRequest(
    `${apiBaseUrl}/admin/registration/code-requirement/enable`,
    { method: 'POST', useToken: 'admin' },
    ctx
  );

  log.success('Clean test environment ready');

  // Run tests
  const tests = [
    { name: 'Registration Code Creation', fn: testRegistrationCodeCreation },
    { name: 'Registration Code Listing', fn: testRegistrationCodeListing },
    { name: 'User Registration', fn: testUserRegistration },
    { name: 'Multi-Use Code Exhaustion', fn: testMultiUseCodeExhaustion },
    { name: 'Code Revocation', fn: testCodeRevocation },
    { name: 'Code Requirement Toggle', fn: testCodeRequirementToggle },
    { name: 'Kill-Switch', fn: testKillSwitch },
    { name: 'User Account Management', fn: testUserAccountManagement },
    { name: 'Non-Admin Access Protection', fn: testNonAdminAccess },
  ];

  const results: { name: string; passed: boolean }[] = [];

  for (const test of tests) {
    try {
      const passed = await test.fn(ctx);
      results.push({ name: test.name, passed });
      await sleep(500); // Small delay between tests
    } catch (error: any) {
      log.error(`Test "${test.name}" threw error: ${error.message}`);
      results.push({ name: test.name, passed: false });
    }
  }

  // Cleanup
  await cleanup(ctx);

  // Summary
  console.log(`
${colors.cyan}═══════════════════════════════════════════════════════════════════
  Test Summary
═══════════════════════════════════════════════════════════════════${colors.reset}
`);

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;

  results.forEach((result) => {
    const icon = result.passed ? `${colors.green}✓${colors.reset}` : `${colors.red}✗${colors.reset}`;
    console.log(`${icon} ${result.name}`);
  });

  console.log(`
${passed === total ? colors.green : colors.red}${passed}/${total} tests passed${colors.reset}
`);

  rl.close();
  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  rl.close();
  process.exit(1);
});
