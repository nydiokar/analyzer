/**
 * Test script to verify bot integration endpoints are working
 * Run this to test your analyzer's bot endpoints before integrating
 * 
 * Usage: node test-bot-endpoints.js
 */

const http = require('http');

const ANALYZER_URL = 'http://localhost:3000';

async function testEndpoints() {
  console.log('🧪 Testing Analyzer Bot Integration Endpoints\n');
  console.log(`Target: ${ANALYZER_URL}\n`);

  // Test all bot endpoints
  const endpoints = [
    { path: '/bot/health', description: 'Health Check' },
    { path: '/bot/security-summary', description: 'Security Summary' },
    { path: '/bot/critical-alerts', description: 'Critical Alerts' }
  ];

  for (const endpoint of endpoints) {
    await testEndpoint(endpoint.path, endpoint.description);
  }

  console.log('\n✅ Endpoint testing complete!');
  console.log('📝 If all tests passed, your analyzer is ready for bot integration.\n');
}

async function testEndpoint(path, description) {
  try {
    console.log(`🔍 Testing: ${description} (${path})`);
    
    const result = await makeRequest(path);
    
    console.log(`✅ SUCCESS: ${description}`);
    console.log(`📊 Response:`, JSON.stringify(result, null, 2));
    console.log('─'.repeat(60));
    
    return result;
    
  } catch (error) {
    console.log(`❌ FAILED: ${description}`);
    console.log(`💥 Error: ${error.message}`);
    console.log('─'.repeat(60));
    
    throw error;
  }
}

function makeRequest(path) {
  return new Promise((resolve, reject) => {
    const url = `${ANALYZER_URL}${path}`;
    
    const req = http.get(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        } catch (error) {
          reject(new Error(`Parse error: ${error.message}`));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(new Error(`Request failed: ${error.message}`));
    });
    
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Request timeout (5s)'));
    });
  });
}

// Run the tests
if (require.main === module) {
  testEndpoints().catch(error => {
    console.error('\n💥 Test suite failed:', error.message);
    console.log('\n🔧 Make sure:');
    console.log('   1. Analyzer service is running (npm run dev or pm2)');
    console.log('   2. Service is accessible at', ANALYZER_URL);
    console.log('   3. No firewall blocking the connection');
    process.exit(1);
  });
}

module.exports = { testEndpoints, makeRequest };