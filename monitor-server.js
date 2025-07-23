#!/usr/bin/env node

const https = require('https');
const http = require('http');
const dns = require('dns').promises;

const SERVER_URL = 'sova-intel.duckdns.org';
const HEALTH_ENDPOINTS = [
  '/api/v1/health',
  '/api/v1/health/queues'
];

// Retry configuration
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 2000; // 2 seconds

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function resolveDomain(hostname) {
  try {
    console.log(`🔍 Resolving DNS for ${hostname}...`);
    const addresses = await dns.resolve4(hostname);
    console.log(`✅ DNS resolved: ${hostname} → ${addresses[0]}`);
    return addresses[0];
  } catch (error) {
    console.log(`❌ DNS resolution failed: ${error.message}`);
    throw error;
  }
}

function makeRequest(url, endpoint, retryCount = 0) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: url,
      port: 443,
      path: endpoint,
      method: 'GET',
      timeout: 15000, // 15 second timeout
      headers: {
        'User-Agent': 'HealthCheck/1.0'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          resolve({
            status: res.statusCode,
            data: jsonData,
            endpoint,
            headers: res.headers
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            data: data,
            endpoint,
            headers: res.headers
          });
        }
      });
    });

    req.on('error', (error) => {
      const errorInfo = {
        error: error.message,
        code: error.code,
        endpoint,
        retryCount
      };
      
      // Special handling for DNS errors
      if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
        errorInfo.error = `DNS resolution failed: ${error.message}`;
      }
      
      reject(errorInfo);
    });

    req.on('timeout', () => {
      req.destroy();
      reject({
        error: 'Request timeout (15s)',
        endpoint,
        retryCount
      });
    });

    req.end();
  });
}

async function makeRequestWithRetry(url, endpoint) {
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`   🔄 Retry attempt ${attempt}/${RETRY_ATTEMPTS}...`);
        await sleep(RETRY_DELAY);
      }
      
      return await makeRequest(url, endpoint, attempt - 1);
    } catch (error) {
      console.log(`   ❌ Attempt ${attempt} failed: ${error.error}`);
      
      if (attempt === RETRY_ATTEMPTS) {
        throw error;
      }
    }
  }
}

function formatHealthStatus(data, endpoint) {
  if (endpoint === '/api/v1/health') {
    return {
      status: data.status,
      responseTime: data.responseTime,
      version: data.version,
      database: data.info?.database?.status || 'unknown'
    };
  } else if (endpoint === '/api/v1/health/queues') {
    return {
      overallStatus: data.status,
      redis: {
        status: data.redis?.status,
        connectionStatus: data.redis?.connectionStatus,
        responseTime: data.redis?.responseTime
      },
      queues: {
        total: data.summary?.totalQueues,
        healthy: data.summary?.healthyQueues,
        activeJobs: data.summary?.totalJobs?.active
      },
      issues: data.issues?.length || 0
    };
  }
  return data;
}

async function checkServerHealth() {
  console.log(`🔍 Checking server health at ${SERVER_URL}...\n`);
  
  // First, try to resolve DNS
  try {
    await resolveDomain(SERVER_URL);
  } catch (error) {
    console.log(`⚠️  DNS resolution failed, but continuing with health checks...\n`);
  }
  
  for (const endpoint of HEALTH_ENDPOINTS) {
    console.log(`📡 Checking ${endpoint}...`);
    
    try {
      const result = await makeRequestWithRetry(SERVER_URL, endpoint);
      
      if (result.status === 200) {
        console.log(`✅ ${endpoint} - Status: ${result.status}`);
        
        const healthInfo = formatHealthStatus(result.data, endpoint);
        
        if (endpoint === '/api/v1/health') {
          console.log(`   🕐 Response Time: ${healthInfo.responseTime}`);
          console.log(`   📦 Version: ${healthInfo.version}`);
          console.log(`   🗄️  Database: ${healthInfo.database}`);
        } else if (endpoint === '/api/v1/health/queues') {
          console.log(`   🎯 Overall Status: ${healthInfo.overallStatus}`);
          console.log(`   🔴 Redis: ${healthInfo.redis.status} (${healthInfo.redis.connectionStatus})`);
          console.log(`   📊 Queues: ${healthInfo.queues.healthy}/${healthInfo.queues.total} healthy`);
          console.log(`   ⚡ Active Jobs: ${healthInfo.queues.activeJobs}`);
          
          if (healthInfo.issues > 0) {
            console.log(`   ⚠️  Issues: ${healthInfo.issues}`);
            result.data.issues?.forEach(issue => console.log(`      - ${issue}`));
          }
        }
      } else {
        console.log(`❌ ${endpoint} - HTTP Status: ${result.status}`);
      }
    } catch (error) {
      console.log(`❌ ${endpoint} - Failed after ${RETRY_ATTEMPTS} attempts`);
      console.log(`   Error: ${error.error}`);
      
      if (error.code) {
        console.log(`   Code: ${error.code}`);
      }
    }
    
    console.log(''); // Empty line for readability
  }
  
  console.log('🏁 Health check completed.');
}

// Run the health check
checkServerHealth().catch(console.error); 