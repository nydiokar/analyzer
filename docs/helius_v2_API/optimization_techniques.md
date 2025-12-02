Example: Efficient program account querying



// ❌ Old approach - could timeout with large datasets
const allAccounts = await connection.getProgramAccounts(programId, {
  encoding: 'base64',
  filters: [{ dataSize: 165 }]
});

// ✅ New approach - paginated with better performance
let allAccounts = [];
let paginationKey = null;

do {
  const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: '1',
      method: 'getProgramAccountsV2',
      params: [
        programId,
        {
          encoding: 'base64',
          filters: [{ dataSize: 165 }],
          limit: 5000,
          ...(paginationKey && { paginationKey })
        }
      ]
    })
  });
  
  const data = await response.json();
  allAccounts.push(...data.result.accounts);
  paginationKey = data.result.paginationKey;
} while (paginationKey);

Incremental updates for real-time applications:

// Get only accounts modified since a specific slot
const incrementalUpdate = await fetch(`https://mainnet.helius-rpc.com/?api-key=${API_KEY}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: '1',
    method: 'getProgramAccountsV2',
    params: [
      programId,
      {
        encoding: 'jsonParsed',
        limit: 1000,
        changedSinceSlot: lastProcessedSlot // Only get recent changes
      }
    ]
  })
});


Data Retrieval Optimization

Efficient Account Queries

/ Batch multiple account queries
const accounts = await connection.getMultipleAccountsInfo([
  pubkey1, pubkey2, pubkey3
], {
  encoding: 'base64',
  commitment: 'confirmed'
});


Token Balance Lookups

// Single call with parsed data
const tokenAccounts = await connection.getTokenAccountsByOwner(owner, {
  programId: TOKEN_PROGRAM_ID
}, { encoding: 'jsonParsed' });

const balances = tokenAccounts.value.map(acc => ({
  mint: acc.account.data.parsed.info.mint,
  amount: acc.account.data.parsed.info.tokenAmount.uiAmount
}));
// ~500ms total - 95% reduction for large wallets

Transaction History 

// Use batch transaction fetching
const signatures = await connection.getSignaturesForAddress(address, { limit: 100 });
const transactions = await connection.getTransactions(
  signatures.map(s => s.signature),
  { maxSupportedTransactionVersion: 0 }
);
// ~2s total - 90% reduction



Real-time Monitoring
​
Account Subscriptions

// Use WebSocket subscriptions for real-time updates
const subscriptionId = connection.onAccountChange(
  pubkey,
  (accountInfo, context) => {
    // Handle real-time updates
    console.log('Account updated:', accountInfo);
  },
  'confirmed',
  { encoding: 'base64', dataSlice: { offset: 0, length: 100 }}
);

transactions monitoring 

// Subscribe to transaction logs for real-time monitoring
const ws = new WebSocket(`wss://mainnet.helius-rpc.com/?api-key=${API_KEY}`);

ws.on('open', () => {
  ws.send(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'logsSubscribe',
    params: [
      { mentions: [programId] },
      { commitment: 'confirmed' }
    ]
  }));
});

ws.on('message', (data) => {
  const message = JSON.parse(data);
  if (message.params) {
    const signature = message.params.result.value.signature;
    // Process transaction signature
  }
});


Advanced Patterns
​
Smart Retry Logic

class RetryManager {
  private backoff = new ExponentialBackoff({
    min: 100,
    max: 5000,
    factor: 2,
    jitter: 0.2
  });

  async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    while (true) {
      try {
        return await operation();
      } catch (error) {
        if (error.message.includes('429')) {
          // Rate limit - wait and retry
          await this.backoff.delay();
          continue;
        }
        throw error;
      }
    }
  }
}


Memory-Efficient Processing

Report incorrect code

Copy

Ask AI
// Process large datasets in chunks
function chunk<T>(array: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(array.length / size) }, (_, i) =>
    array.slice(i * size, i * size + size)
  );
}

// Process program accounts in batches
const allAccounts = await connection.getProgramAccounts(programId, {
  dataSlice: { offset: 0, length: 32 }
});

const chunks = chunk(allAccounts, 100);
for (const batch of chunks) {
  const detailedAccounts = await connection.getMultipleAccountsInfo(
    batch.map(acc => acc.pubkey)
  );
  // Process batch...
}
​
Connection Pooling

Report incorrect code

Copy

Ask AI
class ConnectionPool {
  private connections: Connection[] = [];
  private currentIndex = 0;

  constructor(rpcUrls: string[]) {
    this.connections = rpcUrls.map(url => new Connection(url));
  }

  getConnection(): Connection {
    const connection = this.connections[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.connections.length;
    return connection;
  }
}

const pool = new ConnectionPool([
  'https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY',
  'https://mainnet-backup.helius-rpc.com/?api-key=YOUR_API_KEY'
]);
​
Performance Monitoring
​
Track RPC Usage

Report incorrect code

Copy

Ask AI
class RPCMonitor {
  private metrics = {
    calls: 0,
    errors: 0,
    totalLatency: 0
  };

  async monitoredCall<T>(operation: () => Promise<T>): Promise<T> {
    const start = Date.now();
    this.metrics.calls++;
    
    try {
      const result = await operation();
      this.metrics.totalLatency += Date.now() - start;
      return result;
    } catch (error) {
      this.metrics.errors++;
      throw error;
    }
  }

  getStats() {
    return {
      ...this.metrics,
      averageLatency: this.metrics.totalLatency / this.metrics.calls,
      errorRate: this.metrics.errors / this.metrics.calls
    };
  }
}
​
Best Practices
​
Commitment Levels
processed
confirmed
finalized
Use for: WebSocket subscriptions, real-time updates
Latency: ~400ms
Reliability: Good for most applications
​
Resource Management
​
Error Handling

Report incorrect code

Copy

Ask AI
// Implement robust error handling
async function robustRPCCall<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error.code === -32602) {
      // Invalid params - fix request
      throw new Error('Invalid RPC parameters');
    } else if (error.code === -32005) {
      // Node behind - retry with different node
      throw new Error('Node synchronization issue');
    } else if (error.message.includes('429')) {
      // Rate limit - implement backoff
      throw new Error('Rate limited');
    }
    throw error;
  }
}
​
Common Pitfalls to Avoid
Avoid these common mistakes:
Polling instead of using WebSocket subscriptions
Fetching full account data when only partial data is needed
Not using batch operations for multiple queries
Ignoring rate limits and not implementing proper retry logic
Using finalized commitment when confirmed is sufficient
Not closing subscriptions, leading to memory leaks
​
Summary
By implementing these optimization techniques, you can achieve:
60-90% reduction in API call volume
Significantly lower latency for real-time operations
Reduced bandwidth usage through targeted queries
Better error resilience with smart retry logic
Lower operational costs through efficient resource usage