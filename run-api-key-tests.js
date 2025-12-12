#!/usr/bin/env node

const { exec } = require('child_process');
const path = require('path');

// Run our new API key architecture tests
const testFiles = [
  'tests/api-key-database.service.test.ts',
  'tests/api-key.service.test.ts',
  'tests/admin.controller.integration.test.ts',
  'tests/architecture-validation.test.ts'
];

console.log('🧪 Running API Key Architecture Tests...\n');

testFiles.forEach((testFile, index) => {
  console.log(`${index + 1}. Running ${testFile}...`);

  const command = `node --test -r ts-node/register -r tsconfig-paths/register ${testFile}`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.log(`❌ ${testFile} failed:`);
      console.log(stderr);
      return;
    }

    console.log(`✅ ${testFile} passed`);
    if (stdout) {
      console.log(stdout);
    }
  });
});

console.log('\n📋 Test Summary:');
console.log('- ApiKeyDatabaseService: Pure data access layer for API keys');
console.log('- ApiKeyService: Business logic layer using new database service');
console.log('- AdminController: Integration tests for admin endpoints');
console.log('- Architecture Validation: Ensures clean service boundaries');
console.log('\n🎯 These tests validate the new Domain-Driven Design architecture');
console.log('   before we implement the actual service refactoring.');
