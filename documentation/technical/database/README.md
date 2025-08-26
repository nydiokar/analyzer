# 🗄️ Database Schema - Deep Dive

## 🎯 Overview

The Wallet Analysis System uses **SQLite** as its primary database with **Prisma ORM** for type-safe database operations. The schema is designed to efficiently store and query blockchain transaction data, analysis results, and user preferences while maintaining data integrity and performance.

## 🏗️ Database Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        DATABASE LAYER                           │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │   Core Models   │  │   Analysis      │  │   User Models   │  │
│  │                 │  │   Results       │  │                 │  │
│  │ • Wallet        │  │ • PnL Summary  │  │ • User          │  │
│  │ • Transactions  │  │ • Behavior     │  │ • Activity Logs │  │
│  │ • Token Info    │  │   Profile      │  │ • Favorites     │  │
│  │ • Cache         │  │ • Analysis     │  │ • Notes         │  │
│  │   Management    │  │   Results      │  │                 │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │   Relations     │  │   Indexes       │  │   Constraints   │  │
│  │                 │  │                 │  │                 │  │
│  │ • One-to-One    │  │ • Performance   │  │ • Unique Keys   │  │
│  │ • One-to-Many   │  │   Optimization  │  │ • Foreign Keys  │  │
│  │ • Many-to-Many  │  │ • Query Speed   │  │ • Data          │  │
│  │ • Cascading     │  │ • Search        │  │   Validation    │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## 📊 **Core Data Models**

### **1. Wallet Model** - Central Entity

#### **Purpose**
The `Wallet` model is the **central entity** that tracks metadata for each analyzed wallet, enabling incremental data fetching and bot detection.

#### **Schema Definition**
```prisma
model Wallet {
  address                      String    @id @unique // Solana wallet address
  
  // Transaction Processing Metadata
  firstProcessedTimestamp      Int?     // Oldest transaction timestamp
  newestProcessedSignature     String?  // Newest transaction signature
  newestProcessedTimestamp     Int?     // Newest transaction timestamp
  lastSuccessfulFetchTimestamp DateTime? // Last successful fetch time
  
  // Analysis Metadata
  analyzedTimestampStart       Int?     // Analysis start timestamp
  analyzedTimestampEnd         Int?     // Analysis end timestamp
  
  // Bot Detection & Classification
  classification               String?   @default("unknown") // "bot", "human", "unknown", "institutional"
  classificationConfidence     Float?    // 0.0-1.0 confidence score
  classificationUpdatedAt      DateTime? // Last classification update
  classificationMethod         String?   // "behavioral", "pattern", "manual", "api"
  isVerifiedBot               Boolean   @default(false) // Manual verification flag
  
  // Bot-Specific Metadata
  botType                     String?   // "arbitrage", "mev", "market_maker", "liquidity", "spam"
  botPatternTags              Json?     // Detected patterns array
  
  // Relations
  pnlSummary      WalletPnlSummary?
  behaviorProfile WalletBehaviorProfile?
  activityLogs    ActivityLog[]          @relation("WalletActivityLogs")
  walletNotes     WalletNote[]
  favoritedBy     UserFavoriteWallet[]
  AnalysisResult  AnalysisResult[]
  
  // Indexes for Performance
  @@index([classification])
  @@index([classificationConfidence])
  @@index([isVerifiedBot])
}
```

#### **Key Features**
- **Incremental Processing**: Tracks processed transaction ranges for efficient updates
- **Bot Detection**: Comprehensive bot classification with confidence scoring
- **Pattern Recognition**: Stores detected trading patterns as JSON metadata
- **Performance Indexes**: Optimized queries for classification and verification

#### **Usage Examples**
```typescript
// Find all verified bots
const verifiedBots = await prisma.wallet.findMany({
  where: { isVerifiedBot: true },
  include: { pnlSummary: true, behaviorProfile: true }
});

// Find wallets with high bot confidence
const highConfidenceBots = await prisma.wallet.findMany({
  where: { 
    classification: 'bot',
    classificationConfidence: { gte: 0.8 }
  }
});

// Get wallet with complete analysis data
const wallet = await prisma.wallet.findUnique({
  where: { address: 'wallet_address' },
  include: {
    pnlSummary: true,
    behaviorProfile: true,
    AnalysisResult: true
  }
});
```

### **2. SwapAnalysisInput Model** - Transaction Data

#### **Purpose**
Stores **pre-calculated data** for each swap transaction leg, derived from Helius events. This is the raw input data for all analysis operations.

#### **Schema Definition**
```prisma
model SwapAnalysisInput {
  id                  Int    @id @default(autoincrement())
  walletAddress       String
  signature           String
  timestamp           Int     // Unix timestamp (seconds)
  mint                String  // SPL token mint address
  amount              Float   // Amount of the SPL token
  direction           String  // 'in' or 'out'
  associatedSolValue  Float   // Associated SOL/WSOL value
  associatedUsdcValue Float?  // Associated USDC value (optional)
  interactionType     String  // Helius transaction type
  feeAmount           Float?  // Fee amount in SOL
  feePercentage       Float?  // Fee percentage
  
  // Unique constraint ensures no duplicate transaction legs
  @@unique([signature, mint, direction, amount], name: "signature_mint_direction_amount")
  
  // Performance indexes
  @@index([walletAddress, timestamp])
  @@index([signature])
  @@index([mint])
}
```

#### **Key Features**
- **Transaction Legs**: Each record represents one side of a swap (in/out)
- **Value Tracking**: Both SOL and USDC values for comprehensive analysis
- **Fee Analysis**: Transaction fees and percentages for cost analysis
- **Deduplication**: Unique constraints prevent duplicate processing

#### **Data Flow**
```typescript
// Example transaction data flow
const swapInputs = [
  {
    walletAddress: 'wallet_123',
    signature: 'tx_signature_1',
    timestamp: 1640995200,
    mint: 'token_mint_address',
    amount: 1000.0,
    direction: 'in',
    associatedSolValue: 1.5,
    associatedUsdcValue: 150.0,
    interactionType: 'SWAP',
    feeAmount: 0.000005,
    feePercentage: 0.0003
  },
  {
    walletAddress: 'wallet_123',
    signature: 'tx_signature_1',
    timestamp: 1640995200,
    mint: 'SOL',
    amount: 1.5,
    direction: 'out',
    associatedSolValue: 1.5,
    associatedUsdcValue: 150.0,
    interactionType: 'SWAP',
    feeAmount: 0.000005,
    feePercentage: 0.0003
  }
];
```

### **3. AnalysisResult Model** - Per-Token Analysis

#### **Purpose**
Stores **per-token P&L analysis results** for each wallet, providing the foundation for portfolio analysis and performance tracking.

#### **Schema Definition**
```prisma
model AnalysisResult {
  id            Int    @id @default(autoincrement())
  walletAddress String
  tokenAddress  String
  
  // Core P&L Metrics
  totalAmountIn          Float
  totalAmountOut         Float
  netAmountChange        Float
  totalSolSpent          Float
  totalSolReceived       Float
  totalFeesPaidInSol     Float?
  netSolProfitLoss       Float
  
  // Transaction Counts
  transferCountIn        Int
  transferCountOut        Int
  
  // Timestamps
  firstTransferTimestamp Int?
  lastTransferTimestamp  Int?
  
  // Value Preservation Analysis
  isValuePreservation     Boolean?
  estimatedPreservedValue Float?
  preservationType        String? // "STABLECOIN", "HODL"
  
  // Current Balance Snapshot
  currentRawBalance      String? // Raw balance (string for precision)
  currentUiBalance       Float?  // UI display balance
  currentUiBalanceString String? // String representation
  balanceDecimals        Int?    // Token decimals
  balanceFetchedAt       DateTime? // Balance fetch timestamp
  
  updatedAt DateTime @default(now()) @updatedAt
  
  // Relations
  wallet Wallet @relation(fields: [walletAddress], references: [address], onDelete: Cascade)
  
  // Constraints
  @@unique([walletAddress, tokenAddress])
  @@index([walletAddress])
  @@index([tokenAddress])
  @@index([lastTransferTimestamp])
  @@index([netSolProfitLoss])
}
```

#### **Key Features**
- **Comprehensive P&L**: Tracks all aspects of token trading performance
- **Balance Snapshots**: Current holdings with precision preservation
- **Value Preservation**: Identifies stablecoin holdings and long-term positions
- **Performance Indexes**: Optimized queries for analysis and reporting

#### **Analysis Queries**
```typescript
// Find profitable tokens for a wallet
const profitableTokens = await prisma.analysisResult.findMany({
  where: {
    walletAddress: 'wallet_123',
    netSolProfitLoss: { gt: 0 }
  },
  orderBy: { netSolProfitLoss: 'desc' }
});

// Get portfolio overview
const portfolio = await prisma.analysisResult.findMany({
  where: { walletAddress: 'wallet_123' },
  select: {
    tokenAddress: true,
    netSolProfitLoss: true,
    currentUiBalance: true,
    currentUiBalanceString: true
  }
});

// Find high-value preservation tokens
const preservedTokens = await prisma.analysisResult.findMany({
  where: {
    walletAddress: 'wallet_123',
    isValuePreservation: true
  }
});
```

### **4. WalletPnlSummary Model** - Aggregated P&L

#### **Purpose**
Provides **aggregated P&L metrics** for each wallet, offering high-level performance insights and summary statistics.

#### **Schema Definition**
```prisma
model WalletPnlSummary {
  id            Int    @id @default(autoincrement())
  walletAddress String @unique
  wallet        Wallet @relation(fields: [walletAddress], references: [address])
  
  // Core P&L Metrics
  totalVolume                       Float
  totalFees                         Float
  realizedPnl                       Float
  unrealizedPnl                     Float
  netPnl                            Float
  stablecoinNetFlow                 Float
  
  // Trading Statistics
  averageSwapSize                   Float
  profitableTokensCount             Int
  unprofitableTokensCount           Int
  totalExecutedSwapsCount           Int
  averageRealizedPnlPerExecutedSwap Float
  realizedPnlToTotalVolumeRatio     Float
  totalSignaturesProcessed          Int
  
  // Time Range
  overallFirstTimestamp Int?
  overallLastTimestamp  Int?
  
  // Current Balance
  currentSolBalance   Float? // Current SOL balance
  solBalanceFetchedAt DateTime? // Balance fetch timestamp
  
  updatedAt DateTime @updatedAt
  
  // Relations
  advancedStats AdvancedTradeStats?
  
  @@index([walletAddress])
}
```

#### **Key Features**
- **Portfolio Overview**: Complete wallet performance summary
- **Risk Metrics**: Fee analysis and volume ratios
- **Performance Ratios**: Efficiency metrics and profitability indicators
- **Balance Tracking**: Current SOL holdings and balance history

### **5. WalletBehaviorProfile Model** - Behavioral Analysis

#### **Purpose**
Stores **comprehensive behavioral analysis results** for each wallet, including trading patterns, session analysis, and risk metrics.

#### **Schema Definition**
```prisma
model WalletBehaviorProfile {
  id            Int    @id @default(autoincrement())
  walletAddress String @unique
  wallet        Wallet @relation(fields: [walletAddress], references: [address])
  
  // Core Behavioral Metrics
  buySellRatio             Float
  buySellSymmetry          Float
  averageFlipDurationHours Float
  medianHoldTime           Float
  sequenceConsistency      Float
  flipperScore             Float
  
  // Trading Statistics
  uniqueTokensTraded       Int
  tokensWithBothBuyAndSell Int
  totalTradeCount          Int
  totalBuyCount            Int
  totalSellCount           Int
  completePairsCount       Int
  averageTradesPerToken    Float
  
  // Time Distribution
  tradingTimeDistribution  Json // Behavioral time categories
  percentTradesUnder1Hour  Float
  percentTradesUnder4Hours Float
  
  // Classification
  tradingStyle    String
  confidenceScore Float
  
  // Advanced Metrics
  tradingFrequency Json // Daily/weekly/monthly rates
  tokenPreferences Json // Most traded and held tokens
  riskMetrics      Json // Risk assessment data
  
  // Session Analysis
  sessionCount                  Int
  avgTradesPerSession           Float
  activeTradingPeriods          Json // Trading windows
  averageSessionStartHour       Float
  averageSessionDurationMinutes Float
  
  // Timestamps
  firstTransactionTimestamp Int?
  lastTransactionTimestamp  Int?
  
  updatedAt DateTime @updatedAt
  
  @@index([walletAddress])
}
```

#### **Key Features**
- **Trading Style Classification**: Automatic trader type identification
- **Session Analysis**: Trading session patterns and timing
- **Risk Assessment**: Comprehensive risk metrics and scoring
- **Behavioral Patterns**: Time distribution and frequency analysis

## 🔗 **Data Relationships**

### **Entity Relationship Diagram**
```
┌─────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Wallet    │    │ SwapAnalysisInput│    │ AnalysisResult  │
│             │    │                  │    │                 │
│ • address   │◄───┤ • walletAddress  │◄───┤ • walletAddress │
│ • metadata  │    │ • signature      │    │ • tokenAddress  │
│ • bot info  │    │ • mint           │    │ • P&L data      │
└─────────────┘    │ • direction      │    │ • balances      │
       │           └──────────────────┘    └─────────────────┘
       │
       ▼
┌─────────────┐    ┌──────────────────┐    ┌─────────────────┐
│WalletPnlSum │    │WalletBehavior    │    │   User          │
│             │    │Profile           │    │                 │
│ • summary   │    │ • behavior       │    │ • apiKey        │
│ • stats     │    │ • patterns       │    │ • preferences   │
│ • metrics   │    │ • classification │    │ • activity      │
└─────────────┘    └──────────────────┘    └─────────────────┘
       │                   │                       │
       ▼                   ▼                       ▼
┌─────────────┐    ┌──────────────────┐    ┌─────────────────┐
│AdvancedTrade│    │  ActivityLog     │    │UserFavorite     │
│Stats        │    │                  │    │Wallet           │
│ • advanced  │    │ • user actions   │    │ • favorites     │
│   metrics   │    │ • wallet access  │    │ • tags          │
│ • analysis  │    │ • performance    │    │ • collections   │
└─────────────┘    └──────────────────┘    └─────────────────┘
```

### **Relationship Types**

#### **1. One-to-One Relationships**
```typescript
// Wallet ↔ WalletPnlSummary
const walletWithPnl = await prisma.wallet.findUnique({
  where: { address: 'wallet_123' },
  include: { pnlSummary: true }
});

// Wallet ↔ WalletBehaviorProfile
const walletWithBehavior = await prisma.wallet.findUnique({
  where: { address: 'wallet_123' },
  include: { behaviorProfile: true }
});
```

#### **2. One-to-Many Relationships**
```typescript
// Wallet → AnalysisResult (multiple tokens)
const walletTokens = await prisma.analysisResult.findMany({
  where: { walletAddress: 'wallet_123' }
});

// Wallet → ActivityLog (multiple activities)
const walletActivity = await prisma.activityLog.findMany({
  where: { walletAddress: 'wallet_123' }
});
```

#### **3. Many-to-Many Relationships**
```typescript
// User ↔ Wallet (through UserFavoriteWallet)
const userFavorites = await prisma.userFavoriteWallet.findMany({
  where: { userId: 'user_123' },
  include: { wallet: true }
});

const walletFavoritedBy = await prisma.userFavoriteWallet.findMany({
  where: { walletAddress: 'wallet_123' },
  include: { user: true }
});
```

## 📈 **Performance Optimization**

### **Indexing Strategy**

#### **Primary Indexes**
```sql
-- Wallet classification queries
CREATE INDEX idx_wallet_classification ON Wallet(classification);
CREATE INDEX idx_wallet_confidence ON Wallet(classificationConfidence);
CREATE INDEX idx_wallet_verified ON Wallet(isVerifiedBot);

-- Transaction analysis queries
CREATE INDEX idx_swap_wallet_time ON SwapAnalysisInput(walletAddress, timestamp);
CREATE INDEX idx_swap_signature ON SwapAnalysisInput(signature);
CREATE INDEX idx_swap_mint ON SwapAnalysisInput(mint);

-- Analysis result queries
CREATE INDEX idx_result_wallet ON AnalysisResult(walletAddress);
CREATE INDEX idx_result_token ON AnalysisResult(tokenAddress);
CREATE INDEX idx_result_timestamp ON AnalysisResult(lastTransferTimestamp);
CREATE INDEX idx_result_pnl ON AnalysisResult(netSolProfitLoss);
```

#### **Composite Indexes**
```sql
-- Multi-column queries for complex analysis
CREATE INDEX idx_wallet_time_range ON Wallet(analyzedTimestampStart, analyzedTimestampEnd);
CREATE INDEX idx_swap_wallet_mint ON SwapAnalysisInput(walletAddress, mint);
CREATE INDEX idx_result_wallet_pnl ON AnalysisResult(walletAddress, netSolProfitLoss);
```

### **Query Optimization**

#### **Efficient Wallet Analysis**
```typescript
// Optimized query for complete wallet analysis
const walletAnalysis = await prisma.wallet.findUnique({
  where: { address: 'wallet_123' },
  include: {
    pnlSummary: {
      include: {
        advancedStats: true
      }
    },
    behaviorProfile: true,
    AnalysisResult: {
      where: {
        lastTransferTimestamp: {
          gte: startTimestamp,
          lte: endTimestamp
        }
      },
      orderBy: { lastTransferTimestamp: 'desc' }
    }
  }
});
```

#### **Batch Processing**
```typescript
// Efficient batch wallet processing
const wallets = await prisma.wallet.findMany({
  where: {
    lastSuccessfulFetchTimestamp: {
      lt: new Date(Date.now() - 24 * 60 * 60 * 1000) // 24 hours ago
    }
  },
  select: {
    address: true,
    lastSuccessfulFetchTimestamp: true
  },
  take: 100 // Process in batches
});
```

## 🔒 **Data Integrity & Constraints**

### **Unique Constraints**
```prisma
// Prevent duplicate transaction legs
@@unique([signature, mint, direction, amount], name: "signature_mint_direction_amount")

// Ensure one P&L summary per wallet
@@unique([walletAddress])

// Ensure one behavior profile per wallet
@@unique([walletAddress])

// Ensure one analysis result per wallet-token pair
@@unique([walletAddress, tokenAddress])

// Ensure one favorite per user-wallet pair
@@id([userId, walletAddress])
```

### **Foreign Key Constraints**
```prisma
// Cascade deletion for related data
wallet Wallet @relation(fields: [walletAddress], references: [address], onDelete: Cascade)

// Prevent orphaned records
walletPnlSummary WalletPnlSummary @relation(fields: [walletPnlSummaryId], references: [id], onDelete: Cascade)
```

### **Data Validation**
```typescript
// Prisma validation example
const createAnalysisResult = async (data: CreateAnalysisResultInput) => {
  // Validate required fields
  if (!data.walletAddress || !data.tokenAddress) {
    throw new Error('Wallet address and token address are required');
  }
  
  // Validate numeric ranges
  if (data.netSolProfitLoss < -1000000 || data.netSolProfitLoss > 1000000) {
    throw new Error('P&L value out of reasonable range');
  }
  
  // Create with validation
  return await prisma.analysisResult.create({
    data: {
      ...data,
      updatedAt: new Date()
    }
  });
};
```

## 🚀 **Advanced Features**

### **JSON Field Usage**
```typescript
// Trading time distribution (stored as JSON)
const timeDistribution = {
  ultraFast: 0.15,    // < 1 hour
  veryFast: 0.25,     // 1-4 hours
  fast: 0.35,         // 4-24 hours
  moderate: 0.20,     // 1-7 days
  dayTrader: 0.05     // > 7 days
};

// Active trading periods
const activePeriods = {
  hourlyTradeCounts: {
    "9": 15,  // 9 AM: 15 trades
    "10": 23, // 10 AM: 23 trades
    "14": 8   // 2 PM: 8 trades
  },
  identifiedWindows: [
    {
      startHour: 9,
      endHour: 11,
      tradeCount: 38,
      intensity: "high"
    }
  ],
  activityFocusScore: 0.85
};
```

### **Bot Detection Metadata**
```typescript
// Bot pattern tags
const botPatterns = [
  "high_frequency",      // Many trades per minute
  "micro_transactions",  // Very small trade sizes
  "true_flipper",        // Buy/sell within seconds
  "arbitrage",           // Cross-DEX arbitrage
  "mev_extraction"       // Maximal extractable value
];

// Bot classification data
const botData = {
  classification: "bot",
  classificationConfidence: 0.92,
  classificationMethod: "behavioral",
  botType: "arbitrage",
  botPatternTags: botPatterns,
  isVerifiedBot: false
};
```

## 🔄 **Data Migration & Evolution**

### **Migration Strategy**
```typescript
// Example migration for adding new fields
export async function addBotDetectionFields() {
  await prisma.$executeRaw`
    ALTER TABLE Wallet ADD COLUMN classification TEXT DEFAULT 'unknown';
    ALTER TABLE Wallet ADD COLUMN classificationConfidence REAL;
    ALTER TABLE Wallet ADD COLUMN isVerifiedBot BOOLEAN DEFAULT false;
  `;
  
  // Create indexes for new fields
  await prisma.$executeRaw`
    CREATE INDEX idx_wallet_classification ON Wallet(classification);
    CREATE INDEX idx_wallet_confidence ON Wallet(classificationConfidence);
    CREATE INDEX idx_wallet_verified ON Wallet(isVerifiedBot);
  `;
}
```

### **Data Backfilling**
```typescript
// Backfill bot classification for existing wallets
export async function backfillBotClassification() {
  const wallets = await prisma.wallet.findMany({
    where: { classification: null }
  });
  
  for (const wallet of wallets) {
    const behavior = await prisma.walletBehaviorProfile.findUnique({
      where: { walletAddress: wallet.address }
    });
    
    if (behavior) {
      const classification = classifyWalletBehavior(behavior);
      await prisma.wallet.update({
        where: { address: wallet.address },
        data: {
          classification: classification.type,
          classificationConfidence: classification.confidence,
          classificationMethod: "behavioral",
          classificationUpdatedAt: new Date()
        }
      });
    }
  }
}
```

## 📊 **Monitoring & Maintenance**

### **Database Health Checks**
```typescript
// Check database size and performance
export async function checkDatabaseHealth() {
  const stats = await prisma.$queryRaw`
    SELECT 
      COUNT(*) as total_wallets,
      COUNT(CASE WHEN classification = 'bot' THEN 1 END) as bot_count,
      COUNT(CASE WHEN isVerifiedBot = true THEN 1 END) as verified_bots,
      AVG(classificationConfidence) as avg_confidence
    FROM Wallet
  `;
  
  const tableSizes = await prisma.$queryRaw`
    SELECT 
      name as table_name,
      COUNT(*) as row_count
    FROM sqlite_master 
    WHERE type='table' 
    GROUP BY name
  `;
  
  return { stats, tableSizes };
}
```

### **Performance Monitoring**
```typescript
// Monitor query performance
export async function monitorQueryPerformance() {
  const slowQueries = await prisma.$queryRaw`
    SELECT 
      sql,
      duration,
      timestamp
    FROM query_log 
    WHERE duration > 1000  -- Queries taking > 1 second
    ORDER BY duration DESC
    LIMIT 10
  `;
  
  return slowQueries;
}
```

---

## 📚 **Related Documentation**

- **[Core Analysis Engine](./../core/README.md)** - Business logic implementation
- **[Backend API](./../api/README.md)** - REST API endpoints
- **[Frontend Dashboard](./../frontend/README.md)** - User interface
- **[Deployment Guide](./../deployment/README.md)** - Production deployment
- **[Performance Tuning](./../performance/README.md)** - Database optimization
